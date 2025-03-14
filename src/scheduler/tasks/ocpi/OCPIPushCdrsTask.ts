import ChargingStationStorage from '../../../storage/mongodb/ChargingStationStorage';
import LockingHelper from '../../../locking/LockingHelper';
import LockingManager from '../../../locking/LockingManager';
import Logging from '../../../utils/Logging';
import OCPPUtils from '../../../server/ocpp/utils/OCPPUtils';
import SchedulerTask from '../../SchedulerTask';
import { ServerAction } from '../../../types/Server';
import TagStorage from '../../../storage/mongodb/TagStorage';
import { TaskConfig } from '../../../types/TaskConfig';
import Tenant from '../../../types/Tenant';
import TenantComponents from '../../../types/TenantComponents';
import { TransactionAction } from '../../../types/Transaction';
import TransactionStorage from '../../../storage/mongodb/TransactionStorage';
import Utils from '../../../utils/Utils';
import global from '../../../types/GlobalType';

const MODULE_NAME = 'OCPIPushCdrsTask';

export default class OCPIPushCdrsTask extends SchedulerTask {

  async processTenant(tenant: Tenant, config: TaskConfig): Promise<void> {
    try {
      // Check if OCPI component is active
      if (Utils.isTenantComponentActive(tenant, TenantComponents.OCPI)) {
        // Get the lock
        const ocpiLock = await LockingHelper.acquireOCPIPushCpoCdrsLock(tenant.id);
        if (ocpiLock) {
          try {
            // Get all finished Transaction with no CDR
            const transactionsMDB: {_id: number}[] = await global.database.getCollection<{_id: number}>(tenant.id, 'transactions')
              .aggregate([
                {
                  $match: {
                    'stop': { $exists: true },
                    'ocpiData': { $exists: true },
                    'ocpiData.cdr': null
                  }
                },
                {
                  $project: { '_id': 1 }
                }
              ]).toArray();
            if (!Utils.isEmptyArray(transactionsMDB)) {
              await Logging.logInfo({
                tenantID: tenant.id,
                action: ServerAction.OCPI_PUSH_CDRS,
                module: MODULE_NAME, method: 'processTenant',
                message: `${transactionsMDB.length} Transaction's CDRs are going to be pushed to OCPI`,
              });
              for (const transactionMDB of transactionsMDB) {
                // Get the lock: Used to avoid collision with manual push or end of transaction push
                const ocpiTransactionLock = await LockingHelper.acquireOCPIPushCdrLock(tenant.id, transactionMDB._id);
                if (ocpiTransactionLock) {
                  try {
                    // Get Transaction
                    const transaction = await TransactionStorage.getTransaction(tenant.id, transactionMDB._id, { withUser: true });
                    if (!transaction) {
                      await Logging.logError({
                        tenantID: tenant.id,
                        action: ServerAction.OCPI_PUSH_CDRS,
                        module: MODULE_NAME, method: 'processTenant',
                        message: `Transaction ID '${transactionMDB._id}' not found`,
                      });
                      continue;
                    }
                    if (transaction.ocpiData?.cdr) {
                      await Logging.logInfo({
                        tenantID: tenant.id,
                        action: ServerAction.OCPI_PUSH_CDRS,
                        module: MODULE_NAME, method: 'processTenant',
                        message: `Transaction ID '${transactionMDB._id}' already has his CDR pushed`,
                      });
                      continue;
                    }
                    // Get Charging Station
                    const chargingStation = await ChargingStationStorage.getChargingStation(tenant.id, transaction.chargeBoxID);
                    if (!chargingStation) {
                      await Logging.logError({
                        tenantID: tenant.id,
                        action: ServerAction.OCPI_PUSH_CDRS,
                        module: MODULE_NAME, method: 'processTenant',
                        message: `Charging Station ID '${transaction.chargeBoxID}' not found`,
                      });
                      continue;
                    }
                    // Get Tag
                    const tag = await TagStorage.getTag(tenant.id, transaction.tagID);
                    if (!tag) {
                      await Logging.logError({
                        tenantID: tenant.id,
                        action: ServerAction.OCPI_PUSH_CDRS,
                        module: MODULE_NAME, method: 'processTenant',
                        message: `Tag ID '${transaction.tagID}' not found`,
                      });
                      continue;
                    }
                    // Roaming
                    await OCPPUtils.processTransactionRoaming(tenant, transaction, chargingStation, tag, TransactionAction.END);
                    // Save
                    await TransactionStorage.saveTransactionOcpiData(tenant.id, transaction.id, transaction.ocpiData);
                    // Ok
                    await Logging.logInfo({
                      tenantID: tenant.id,
                      action: ServerAction.OCPI_PUSH_CDRS,
                      actionOnUser: (transaction.user ? transaction.user : null),
                      module: MODULE_NAME, method: 'processTenant',
                      message: `CDR of Transaction ID '${transaction.id}' has been pushed successfully`,
                      detailedMessages: { cdr: transaction.ocpiData.cdr }
                    });
                  } catch (error) {
                    await Logging.logError({
                      tenantID: tenant.id,
                      action: ServerAction.OCPI_PUSH_CDRS,
                      module: MODULE_NAME, method: 'processTenant',
                      message: `Failed to pushed the CDR of the Transaction ID '${transactionMDB._id}' to OCPI`,
                      detailedMessages: { error: error.stack, transaction: transactionMDB }
                    });
                  } finally {
                    // Release the lock
                    await LockingManager.release(ocpiTransactionLock);
                  }
                }
              }
            }
          } finally {
            // Release the lock
            await LockingManager.release(ocpiLock);
          }
        }
      }
    } catch (error) {
      await Logging.logActionExceptionMessage(tenant.id, ServerAction.OCPI_PULL_CDRS, error);
    }
  }
}

