import { BillingStatus, TransactionBillingData } from '../../types/Billing';
import RefundReport, { RefundStatus, TransactionRefundData } from '../../types/Refund';
import Transaction, { TransactionOcpiData, TransactionOicpData } from '../../types/Transaction';
import { TransactionInError, TransactionInErrorType } from '../../types/InError';
import global, { FilterParams } from './../../types/GlobalType';

import Constants from '../../utils/Constants';
import ConsumptionStorage from './ConsumptionStorage';
import { DataResult } from '../../types/DataResult';
import DatabaseUtils from './DatabaseUtils';
import DbParams from '../../types/database/DbParams';
import Logging from '../../utils/Logging';
import { NotifySessionNotStarted } from '../../types/UserNotifications';
import { ServerAction } from '../../types/Server';
import Utils from '../../utils/Utils';
import moment from 'moment';

const MODULE_NAME = 'TransactionStorage';

export default class TransactionStorage {
  public static async deleteTransaction(tenantID: string, transactionID: number): Promise<void> {
    await TransactionStorage.deleteTransactions(tenantID, [transactionID]);
  }

  public static async deleteTransactions(tenantID: string, transactionsIDs: number[]): Promise<number> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenantID, MODULE_NAME, 'deleteTransaction');
    // Check
    await DatabaseUtils.checkTenant(tenantID);
    // Delete
    const result = await global.database.getCollection<Transaction>(tenantID, 'transactions')
      .deleteMany({ '_id': { $in: transactionsIDs } });
    // Delete Meter Values
    await global.database.getCollection<any>(tenantID, 'metervalues')
      .deleteMany({ 'transactionId': { $in: transactionsIDs } });
    // Delete Consumptions
    await ConsumptionStorage.deleteConsumptions(tenantID, transactionsIDs);
    // Debug
    await Logging.traceEnd(tenantID, MODULE_NAME, 'deleteTransaction', uniqueTimerID, { transactionsIDs });
    return result.deletedCount;
  }

  public static async saveTransaction(tenantID: string, transactionToSave: Transaction): Promise<number> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenantID, MODULE_NAME, 'saveTransaction');
    // Check
    await DatabaseUtils.checkTenant(tenantID);
    // ID not provided?
    if (!transactionToSave.id) {
      transactionToSave.id = await TransactionStorage.findAvailableID(tenantID);
    }
    // Transfer
    const transactionMDB: any = {
      _id: Utils.convertToInt(transactionToSave.id),
      issuer: Utils.convertToBoolean(transactionToSave.issuer),
      companyID: DatabaseUtils.convertToObjectID(transactionToSave.companyID),
      siteID: DatabaseUtils.convertToObjectID(transactionToSave.siteID),
      siteAreaID: DatabaseUtils.convertToObjectID(transactionToSave.siteAreaID),
      connectorId: Utils.convertToInt(transactionToSave.connectorId),
      tagID: transactionToSave.tagID,
      carID: transactionToSave.carID ? DatabaseUtils.convertToObjectID(transactionToSave.carID) : null,
      carCatalogID: transactionToSave.carCatalogID ? Utils.convertToInt(transactionToSave.carCatalogID) : null,
      userID: DatabaseUtils.convertToObjectID(transactionToSave.userID),
      chargeBoxID: transactionToSave.chargeBoxID,
      meterStart: Utils.convertToInt(transactionToSave.meterStart),
      timestamp: Utils.convertToDate(transactionToSave.timestamp),
      price: Utils.convertToFloat(transactionToSave.price),
      roundedPrice: Utils.convertToFloat(transactionToSave.roundedPrice),
      priceUnit: transactionToSave.priceUnit,
      pricingSource: transactionToSave.pricingSource,
      stateOfCharge: transactionToSave.stateOfCharge,
      timezone: transactionToSave.timezone,
      signedData: transactionToSave.signedData,
      numberOfMeterValues: Utils.convertToInt(transactionToSave.numberOfMeterValues),
      currentStateOfCharge: Utils.convertToInt(transactionToSave.currentStateOfCharge),
      currentSignedData: transactionToSave.currentSignedData,
      lastConsumption: transactionToSave.lastConsumption,
      currentTotalInactivitySecs: Utils.convertToInt(transactionToSave.currentTotalInactivitySecs),
      currentInactivityStatus: transactionToSave.currentInactivityStatus,
      currentCumulatedPrice: Utils.convertToFloat(transactionToSave.currentCumulatedPrice),
      transactionEndReceived: Utils.convertToBoolean(transactionToSave.transactionEndReceived),
      currentInstantWatts: Utils.convertToFloat(transactionToSave.currentInstantWatts),
      currentInstantWattsL1: Utils.convertToFloat(transactionToSave.currentInstantWattsL1),
      currentInstantWattsL2: Utils.convertToFloat(transactionToSave.currentInstantWattsL2),
      currentInstantWattsL3: Utils.convertToFloat(transactionToSave.currentInstantWattsL3),
      currentInstantWattsDC: Utils.convertToFloat(transactionToSave.currentInstantWattsDC),
      currentTotalConsumptionWh: Utils.convertToFloat(transactionToSave.currentTotalConsumptionWh),
      currentTotalDurationSecs: Utils.convertToInt(transactionToSave.currentTotalDurationSecs),
      currentInstantVolts: Utils.convertToFloat(transactionToSave.currentInstantVolts),
      currentInstantVoltsL1: Utils.convertToInt(transactionToSave.currentInstantVoltsL1),
      currentInstantVoltsL2: Utils.convertToInt(transactionToSave.currentInstantVoltsL2),
      currentInstantVoltsL3: Utils.convertToInt(transactionToSave.currentInstantVoltsL3),
      currentInstantVoltsDC: Utils.convertToInt(transactionToSave.currentInstantVoltsDC),
      currentInstantAmps: Utils.convertToFloat(transactionToSave.currentInstantAmps),
      currentInstantAmpsL1: Utils.convertToInt(transactionToSave.currentInstantAmpsL1),
      currentInstantAmpsL2: Utils.convertToInt(transactionToSave.currentInstantAmpsL2),
      currentInstantAmpsL3: Utils.convertToInt(transactionToSave.currentInstantAmpsL3),
      currentInstantAmpsDC: Utils.convertToInt(transactionToSave.currentInstantAmpsDC),
      migrationTag: transactionToSave.migrationTag,
    };
    if (transactionToSave.phasesUsed) {
      transactionMDB.phasesUsed = {
        csPhase1: Utils.convertToBoolean(transactionToSave.phasesUsed.csPhase1),
        csPhase2: Utils.convertToBoolean(transactionToSave.phasesUsed.csPhase2),
        csPhase3: Utils.convertToBoolean(transactionToSave.phasesUsed.csPhase3),
      };
    }
    if (transactionToSave.stop) {
      // Add stop
      transactionMDB.stop = {
        userID: DatabaseUtils.convertToObjectID(transactionToSave.stop.userID),
        timestamp: Utils.convertToDate(transactionToSave.stop.timestamp),
        tagID: transactionToSave.stop.tagID,
        meterStop: transactionToSave.stop.meterStop,
        reason: transactionToSave.stop.reason,
        transactionData: transactionToSave.stop.transactionData,
        stateOfCharge: Utils.convertToInt(transactionToSave.stop.stateOfCharge),
        signedData: transactionToSave.stop.signedData,
        totalConsumptionWh: Utils.convertToFloat(transactionToSave.stop.totalConsumptionWh),
        totalInactivitySecs: Utils.convertToInt(transactionToSave.stop.totalInactivitySecs),
        extraInactivitySecs: Utils.convertToInt(transactionToSave.stop.extraInactivitySecs),
        extraInactivityComputed: !!transactionToSave.stop.extraInactivityComputed,
        inactivityStatus: transactionToSave.stop.inactivityStatus,
        totalDurationSecs: Utils.convertToInt(transactionToSave.stop.totalDurationSecs),
        price: Utils.convertToFloat(transactionToSave.stop.price),
        roundedPrice: Utils.convertToFloat(transactionToSave.stop.roundedPrice),
        priceUnit: transactionToSave.priceUnit,
        pricingSource: transactionToSave.stop.pricingSource
      };
      // Remove runtime props
      delete transactionMDB.currentInstantWatts;
      delete transactionMDB.currentInstantWattsL1;
      delete transactionMDB.currentInstantWattsL2;
      delete transactionMDB.currentInstantWattsL3;
      delete transactionMDB.currentInstantWattsDC;
      delete transactionMDB.currentCumulatedPrice;
      delete transactionMDB.currentSignedData;
      delete transactionMDB.currentStateOfCharge;
      delete transactionMDB.currentTotalConsumptionWh;
      delete transactionMDB.currentTotalInactivitySecs;
      delete transactionMDB.currentInactivityStatus;
      delete transactionMDB.lastConsumption;
      delete transactionMDB.numberOfMeterValues;
      delete transactionMDB.currentTotalDurationSecs;
      delete transactionMDB.currentInstantVolts;
      delete transactionMDB.currentInstantVoltsL1;
      delete transactionMDB.currentInstantVoltsL2;
      delete transactionMDB.currentInstantVoltsL3;
      delete transactionMDB.currentInstantVoltsDC;
      delete transactionMDB.currentInstantAmps;
      delete transactionMDB.transactionEndReceived;
      delete transactionMDB.currentInstantAmpsL1;
      delete transactionMDB.currentInstantAmpsL2;
      delete transactionMDB.currentInstantAmpsL3;
      delete transactionMDB.currentInstantAmpsDC;
    }
    if (transactionToSave.remotestop) {
      transactionMDB.remotestop = {
        timestamp: Utils.convertToDate(transactionToSave.remotestop.timestamp),
        tagID: transactionToSave.remotestop.tagID,
        userID: DatabaseUtils.convertToObjectID(transactionToSave.remotestop.userID)
      };
    }
    if (transactionToSave.refundData) {
      transactionMDB.refundData = {
        refundId: transactionToSave.refundData.refundId,
        refundedAt: Utils.convertToDate(transactionToSave.refundData.refundedAt),
        status: transactionToSave.refundData.status,
        reportId: transactionToSave.refundData.reportId
      };
    }
    if (transactionToSave.billingData) {
      transactionMDB.billingData = {
        withBillingActive: transactionToSave.billingData.withBillingActive,
        lastUpdate: Utils.convertToDate(transactionToSave.billingData.lastUpdate),
        stop: {
          status: transactionToSave.billingData.stop?.status,
          invoiceID: DatabaseUtils.convertToObjectID(transactionToSave.billingData.stop?.invoiceID),
          invoiceNumber: transactionToSave.billingData.stop?.invoiceNumber,
          invoiceStatus: transactionToSave.billingData.stop?.invoiceStatus,
          invoiceItem: transactionToSave.billingData.stop?.invoiceItem,
        },
      };
    }
    if (transactionToSave.ocpiData) {
      transactionMDB.ocpiData = {
        session: transactionToSave.ocpiData.session,
        cdr: transactionToSave.ocpiData.cdr
      };
      if (transactionToSave.ocpiData.sessionCheckedOn) {
        transactionMDB.ocpiData.sessionCheckedOn = transactionToSave.ocpiData.sessionCheckedOn;
      }
      if (transactionToSave.ocpiData.cdrCheckedOn) {
        transactionMDB.ocpiData.cdrCheckedOn = transactionToSave.ocpiData.cdrCheckedOn;
      }
    }
    if (transactionToSave.oicpData) {
      transactionMDB.oicpData = {
        session: transactionToSave.oicpData.session,
        cdr: transactionToSave.oicpData.cdr
      };
    }
    // Modify
    await global.database.getCollection<any>(tenantID, 'transactions').findOneAndReplace(
      { '_id': Utils.convertToInt(transactionToSave.id) },
      transactionMDB,
      { upsert: true });
    // Debug
    await Logging.traceEnd(tenantID, MODULE_NAME, 'saveTransaction', uniqueTimerID, transactionMDB);
    // Return
    return transactionToSave.id;
  }

  public static async saveTransactionOcpiData(tenantID: string, id: number,
      ocpiData: TransactionOcpiData): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenantID, MODULE_NAME, 'saveTransactionOcpiData');
    // Check Tenant
    await DatabaseUtils.checkTenant(tenantID);
    // Modify document
    await global.database.getCollection<Transaction>(tenantID, 'transactions').findOneAndUpdate(
      { '_id': id },
      {
        $set: {
          ocpiData
        }
      },
      { upsert: false });
    // Debug
    await Logging.traceEnd(tenantID, MODULE_NAME, 'saveTransactionOcpiData', uniqueTimerID, ocpiData);
  }

  public static async saveTransactionOicpData(tenantID: string, id: number,
      oicpData: TransactionOicpData): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenantID, MODULE_NAME, 'saveTransactionOicpData');
    // Check Tenant
    await DatabaseUtils.checkTenant(tenantID);
    // Modify document
    await global.database.getCollection<Transaction>(tenantID, 'transactions').findOneAndUpdate(
      { '_id': id },
      {
        $set: {
          oicpData
        }
      },
      { upsert: false });
    // Debug
    await Logging.traceEnd(tenantID, MODULE_NAME, 'saveTransactionOicpData', uniqueTimerID, oicpData);
  }

  public static async saveTransactionBillingData(tenantID: string, id: number,
      billingData: TransactionBillingData): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenantID, MODULE_NAME, 'saveTransactionBillingData');
    // Check Tenant
    await DatabaseUtils.checkTenant(tenantID);
    // Modify document
    await global.database.getCollection<Transaction>(tenantID, 'transactions').findOneAndUpdate(
      { '_id': id },
      {
        $set: {
          billingData
        }
      },
      { upsert: false });
    // Debug
    await Logging.traceEnd(tenantID, MODULE_NAME, 'saveTransactionBillingData', uniqueTimerID, billingData);
  }

  public static async saveTransactionRefundData(tenantID: string, id: number,
      refundData: TransactionRefundData): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenantID, MODULE_NAME, 'saveTransactionRefundData');
    // Check Tenant
    await DatabaseUtils.checkTenant(tenantID);
    // Modify document
    await global.database.getCollection<Transaction>(tenantID, 'transactions').findOneAndUpdate(
      { '_id': id },
      {
        $set: {
          refundData
        }
      },
      { upsert: false });
    // Debug
    await Logging.traceEnd(tenantID, MODULE_NAME, 'saveTransactionRefundData', uniqueTimerID, refundData);
  }

  public static async assignTransactionsToUser(tenantID: string, userID: string, tagID: string): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenantID, MODULE_NAME, 'assignTransactionsToUser');
    // Assign transactions
    await global.database.getCollection(tenantID, 'transactions').updateMany({
      $and: [
        { 'userID': null },
        { 'tagID': tagID }
      ]
    }, {
      $set: {
        userID: DatabaseUtils.convertToObjectID(userID)
      }
    });
    // Debug
    await Logging.traceEnd(tenantID, MODULE_NAME, 'assignTransactionsToUser', uniqueTimerID);
  }

  public static async getUnassignedTransactionsCount(tenantID: string, tagID: string): Promise<number> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenantID, MODULE_NAME, 'getUnassignedTransactionsCount');
    // Get the number of unassigned transactions
    const unassignedCount = await global.database.getCollection<Transaction>(tenantID, 'transactions').find({
      $and: [
        { 'userID': null },
        { 'tagID': tagID }
      ]
    }).count();
    // Debug
    await Logging.traceEnd(tenantID, MODULE_NAME, 'getUnassignedTransactionsCount', uniqueTimerID);
    return unassignedCount;
  }

  public static async getTransactionYears(tenantID: string): Promise<Date[]> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenantID, MODULE_NAME, 'getTransactionYears');
    // Check
    await DatabaseUtils.checkTenant(tenantID);
    const firstTransactionsMDB = await global.database.getCollection<Transaction>(tenantID, 'transactions')
      .find({})
      .sort({ timestamp: 1 })
      .limit(1)
      .toArray();
    // Found?
    if (Utils.isEmptyArray(firstTransactionsMDB)) {
      return null;
    }
    const transactionYears = [];
    // Push the rest of the years up to now
    for (let i = new Date(firstTransactionsMDB[0].timestamp).getFullYear(); i <= new Date().getFullYear(); i++) {
      transactionYears.push(i);
    }
    // Debug
    await Logging.traceEnd(tenantID, MODULE_NAME, 'getTransactionYears', uniqueTimerID, firstTransactionsMDB);
    return transactionYears;
  }

  public static async getTransactions(tenantID: string,
      params: {
        transactionIDs?: number[]; issuer?: boolean; search?: string; ownerID?: string; userIDs?: string[]; siteAdminIDs?: string[];
        chargeBoxIDs?: string[]; siteAreaIDs?: string[]; siteIDs?: string[]; connectorIDs?: number[]; startDateTime?: Date; withChargingStation?: boolean;
        endDateTime?: Date; stop?: any; minimalPrice?: boolean; reportIDs?: string[]; tagIDs?: string[]; inactivityStatus?: string[];
        ocpiSessionID?: string; ocpiAuthorizationID?: string; ocpiSessionDateFrom?: Date; ocpiSessionDateTo?: Date; ocpiCdrDateFrom?: Date; ocpiCdrDateTo?: Date;
        ocpiSessionChecked?: boolean; ocpiCdrChecked?: boolean; oicpSessionID?: string; withSite?: boolean; withSiteArea?: boolean; withCompany?: boolean;
        statistics?: 'refund' | 'history' | 'ongoing'; refundStatus?: string[]; withTag?: boolean; hasUserID?: boolean; withUser?: boolean; withCar?: boolean;
      },
      dbParams: DbParams, projectFields?: string[]):
      Promise<{
        count: number; result: Transaction[]; stats: {
          totalConsumptionWattHours?: number; totalPriceRefund?: number; totalPricePending?: number;
          countRefundTransactions?: number; countPendingTransactions?: number; countRefundedReports?: number; totalDurationSecs?: number;
          totalPrice?: number; currency?: string; totalInactivitySecs?: number; count: number;
        };
      }> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenantID, MODULE_NAME, 'getTransactions');
    // Check
    await DatabaseUtils.checkTenant(tenantID);
    // Clone before updating the values
    dbParams = Utils.cloneObject(dbParams);
    // Check Limit
    dbParams.limit = Utils.checkRecordLimit(dbParams.limit);
    // Check Skip
    dbParams.skip = Utils.checkRecordSkip(dbParams.skip);
    // Build filter
    const ownerMatch = { $or: [] };
    const filters: FilterParams = {};
    // User / Site Admin
    if (params.ownerID) {
      ownerMatch.$or.push({
        userID: DatabaseUtils.convertToObjectID(params.ownerID)
      });
    }
    if (params.siteAdminIDs) {
      ownerMatch.$or.push({
        siteID: {
          $in: params.siteAdminIDs.map((siteID) => DatabaseUtils.convertToObjectID(siteID))
        }
      });
    }
    // Create Aggregation
    const aggregation = [];
    // Filter?
    if (params.search) {
      // Build filter
      filters.$or = [
        { '_id': Utils.convertToInt(params.search) },
        { 'tagID': { $regex: params.search, $options: 'i' } },
        { 'chargeBoxID': { $regex: params.search, $options: 'i' } },
        { 'ocpiData.session.authorization_id': { $regex: params.search, $options: 'i' } }
      ];
    }
    // OCPI ID
    if (params.ocpiSessionID) {
      filters['ocpiData.session.id'] = params.ocpiSessionID;
    }
    // Authorization ID
    if (params.ocpiAuthorizationID) {
      filters['ocpiData.session.authorization_id'] = params.ocpiAuthorizationID;
    }
    // OICP ID
    if (params.oicpSessionID) {
      filters['oicpData.session.id'] = params.oicpSessionID;
    }
    // Transaction
    if (!Utils.isEmptyArray(params.transactionIDs)) {
      filters._id = {
        $in: params.transactionIDs
      };
    }
    // Issuer
    if (Utils.objectHasProperty(params, 'issuer') && Utils.isBoolean(params.issuer)) {
      filters.issuer = params.issuer;
    }
    // User
    if (params.userIDs) {
      filters.userID = { $in: params.userIDs.map((siteID) => DatabaseUtils.convertToObjectID(siteID)) };
    }
    // Charge Box
    if (params.chargeBoxIDs) {
      filters.chargeBoxID = { $in: params.chargeBoxIDs };
    }
    // Tag
    if (params.tagIDs) {
      filters.tagID = { $in: params.tagIDs };
    }
    // Has user ID?
    if (params.hasUserID) {
      filters.$and = [
        { 'userID': { '$exists': true } },
        { 'userID': { '$ne': null } }
      ];
    }
    // Connector
    if (!Utils.isEmptyArray(params.connectorIDs)) {
      filters.connectorId = {
        $in: params.connectorIDs.map((connectorID) => DatabaseUtils.convertToObjectID(connectorID))
      };
    }
    // Date provided?
    if (params.startDateTime || params.endDateTime) {
      filters.timestamp = {};
      // Start date
      if (params.startDateTime) {
        filters.timestamp.$gte = Utils.convertToDate(params.startDateTime);
      }
      // End date
      if (params.endDateTime) {
        filters.timestamp.$lte = Utils.convertToDate(params.endDateTime);
      }
    }
    // OCPI Session Date provided?
    if (params.ocpiSessionDateFrom || params.ocpiSessionDateTo) {
      // Start date
      if (params.ocpiSessionDateFrom) {
        filters['ocpiData.session.last_updated'] = { $gte: Utils.convertToDate(params.ocpiSessionDateFrom) };
      }
      // End date
      if (params.ocpiSessionDateTo) {
        filters['ocpiData.session.last_updated'] = { $lte: Utils.convertToDate(params.ocpiSessionDateTo) };
      }
    }
    if (Utils.objectHasProperty(params, 'ocpiSessionChecked')) {
      filters.stop = { $exists: true };
      filters['ocpiData.session'] = { $exists: true, $ne: null };
      filters['ocpiData.sessionCheckedOn'] = { $exists: params.ocpiSessionChecked };
    }
    // OCPI Cdr Date provided?
    if (params.ocpiCdrDateFrom || params.ocpiCdrDateTo) {
      // Start date
      if (params.ocpiCdrDateFrom) {
        filters['ocpiData.cdr.last_updated'] = { $gte: Utils.convertToDate(params.ocpiCdrDateFrom) };
      }
      // End date
      if (params.ocpiCdrDateTo) {
        filters['ocpiData.cdr.last_updated'] = { $lte: Utils.convertToDate(params.ocpiCdrDateTo) };
      }
    }
    if (Utils.objectHasProperty(params, 'ocpiCdrChecked')) {
      filters.stop = { $exists: true };
      filters['ocpiData.cdr'] = { $exists: true, $ne: null };
      filters['ocpiData.cdrCheckedOn'] = { $exists: params.ocpiCdrChecked };
    }
    // Check stop transaction
    if (params.stop) {
      filters.stop = filters.stop ? { ...filters.stop, ...params.stop } : params.stop;
    }
    // Inactivity Status
    if (params.inactivityStatus) {
      filters['stop.inactivityStatus'] = { $in: params.inactivityStatus };
    }
    // Site's area ID
    if (params.siteAreaIDs) {
      filters.siteAreaID = {
        $in: params.siteAreaIDs.map((siteAreaID) => DatabaseUtils.convertToObjectID(siteAreaID))
      };
    }
    // Site ID
    if (params.siteIDs) {
      filters.siteID = {
        $in: params.siteIDs.map((siteID) => DatabaseUtils.convertToObjectID(siteID))
      };
    }
    // Refund status
    if (params.refundStatus && params.refundStatus.length > 0) {
      const statuses = params.refundStatus.map((status) => status === RefundStatus.NOT_SUBMITTED ? null : status);
      filters['refundData.status'] = {
        $in: statuses
      };
    }
    // Minimal Price
    if (params.minimalPrice) {
      filters['stop.price'] = { $gt: Utils.convertToInt(params.minimalPrice) };
    }
    // Report ID
    if (params.reportIDs) {
      filters['refundData.reportId'] = { $in: params.reportIDs };
    }
    // Filters
    if (ownerMatch.$or && ownerMatch.$or.length > 0) {
      aggregation.push({
        $match: {
          $and: [ownerMatch, filters]
        }
      });
    } else {
      aggregation.push({
        $match: filters
      });
    }
    // Limit records?
    if (!dbParams.onlyRecordCount) {
      // Always limit the nbr of record to avoid perfs issues
      aggregation.push({ $limit: Constants.DB_RECORD_COUNT_CEIL });
    }
    // Prepare statistics query
    let statsQuery = null;
    switch (params.statistics) {
      case 'history': // For historical case
        statsQuery = {
          $group: {
            _id: null,
            firstTimestamp: { $min: '$timestamp' },
            lastTimestamp: { $max: '$timestamp' },
            totalConsumptionWattHours: { $sum: '$stop.totalConsumptionWh' },
            totalDurationSecs: { $sum: '$stop.totalDurationSecs' },
            totalPrice: { $sum: '$stop.price' },
            totalInactivitySecs: { '$sum': { $add: ['$stop.totalInactivitySecs', '$stop.extraInactivitySecs'] } },
            currency: { $addToSet: '$stop.priceUnit' },
            count: { $sum: 1 }
          }
        };
        break;
      case 'ongoing': // For ongoing case
        statsQuery = {
          $group: {
            _id: null,
            firstTimestamp: { $min: '$timestamp' },
            lastTimestamp: { $max: '$timestamp' },
            totalConsumptionWattHours: { $sum: '$currentTotalConsumptionWh' },
            totalDurationSecs: { $sum: '$currentTotalDurationSecs' },
            totalPrice: { $sum: '$currentCumulatedPrice' },
            totalInactivitySecs: { $sum:  '$currentTotalInactivitySecs' },
            currency: { $addToSet: '$priceUnit' },
            count: { $sum: 1 }
          }
        };
        break;
      case 'refund': // For refund case
        statsQuery = {
          $group: {
            _id: null,
            firstTimestamp: { $min: '$timestamp' },
            lastTimestamp: { $max: '$timestamp' },
            totalConsumptionWattHours: { $sum: '$stop.totalConsumptionWh' },
            totalPriceRefund: { $sum: { $cond: [{ '$in': ['$refundData.status', [RefundStatus.SUBMITTED, RefundStatus.APPROVED]] }, '$stop.price', 0] } },
            totalPricePending: { $sum: { $cond: [{ '$in': ['$refundData.status', [RefundStatus.SUBMITTED, RefundStatus.APPROVED]] }, 0, '$stop.price'] } },
            countRefundTransactions: { $sum: { $cond: [{ '$in': ['$refundData.status', [RefundStatus.SUBMITTED, RefundStatus.APPROVED]] }, 1, 0] } },
            countPendingTransactions: { $sum: { $cond: [{ '$in': ['$refundData.status', [RefundStatus.SUBMITTED, RefundStatus.APPROVED]] }, 0, 1] } },
            currency: { $addToSet: '$stop.priceUnit' },
            countRefundedReports: { $addToSet: '$refundData.reportId' },
            count: { $sum: 1 }
          }
        };
        break;
      default: // Default case only count
        statsQuery = {
          $group: {
            _id: null,
            count: { $sum: 1 }
          }
        };
        break;
    }
    // Count Records
    const transactionsCountMDB = await global.database.getCollection<any>(tenantID, 'transactions')
      .aggregate([...aggregation, statsQuery], { allowDiskUse: true })
      .toArray();
    let transactionCountMDB = (transactionsCountMDB && transactionsCountMDB.length > 0) ? transactionsCountMDB[0] : null;
    // Initialize statistics
    if (!transactionCountMDB) {
      switch (params.statistics) {
        case 'history':
        case 'ongoing':
          transactionCountMDB = {
            totalConsumptionWattHours: 0,
            totalDurationSecs: 0,
            totalPrice: 0,
            totalInactivitySecs: 0,
            count: 0
          };
          break;
        case 'refund':
          transactionCountMDB = {
            totalConsumptionWattHours: 0,
            totalPriceRefund: 0,
            totalPricePending: 0,
            countRefundTransactions: 0,
            countPendingTransactions: 0,
            countRefundedReports: 0,
            count: 0
          };
          break;
        default:
          transactionCountMDB = {
            count: 0
          };
          break;
      }
    }
    // Translate array response to number
    if (transactionCountMDB && transactionCountMDB.countRefundedReports) {
      transactionCountMDB.countRefundedReports = transactionCountMDB.countRefundedReports.length;
    }
    // Take first entry as reference currency. Expectation is that we have only one currency for all transaction
    if (transactionCountMDB && transactionCountMDB.currency) {
      transactionCountMDB.currency = transactionCountMDB.currency[0];
    }
    // Check if only the total count is requested
    if (dbParams.onlyRecordCount) {
      await Logging.traceEnd(tenantID, MODULE_NAME, 'getTransactions', uniqueTimerID, transactionCountMDB);
      return {
        count: transactionCountMDB ? transactionCountMDB.count : 0,
        stats: transactionCountMDB ? transactionCountMDB : {},
        result: []
      };
    }
    // Remove the limit
    aggregation.pop();
    // Sort
    if (!dbParams.sort) {
      dbParams.sort = { timestamp: -1 };
    }
    if (!dbParams.sort.timestamp) {
      aggregation.push({
        $sort: { ...dbParams.sort, timestamp: -1 }
      });
    } else {
      aggregation.push({
        $sort: dbParams.sort
      });
    }
    // Skip
    aggregation.push({
      $skip: dbParams.skip
    });
    // Limit
    aggregation.push({
      $limit: dbParams.limit
    });
    // Add OCPI data
    if (projectFields && projectFields.includes('ocpi')) {
      aggregation.push({
        $addFields: {
          'ocpi': { $gt: ['$ocpiData', null] }
        }
      });
    }
    if (projectFields && projectFields.includes('ocpiWithCdr')) {
      aggregation.push({
        $addFields: {
          'ocpiWithCdr': {
            $cond: { if: { $and: [{ $gt: ['$ocpiData', null] }, { $gt: ['$ocpiData.cdr', null] }] }, then: true, else: false }
          }
        }
      });
    }
    // Tag
    if (params.withTag) {
      DatabaseUtils.pushTagLookupInAggregation({
        tenantID, aggregation: aggregation, asField: 'tag', localField: 'tagID',
        foreignField: '_id', oneToOneCardinality: true
      });
      // TODO: [To Investigate] Cause big perf issue in prod (local it takes 2sec with this lookup instead of 165ms, in prod it can takes up to 20s)
      // DatabaseUtils.pushTagLookupInAggregation({
      //   tenantID, aggregation: aggregation, asField: 'stop.tag', localField: 'stop.tagID',
      //   foreignField: '_id', oneToOneCardinality: true
      // });
    }
    // Company
    if (params.withCompany) {
      DatabaseUtils.pushCompanyLookupInAggregation({
        tenantID, aggregation: aggregation, localField: 'companyID', foreignField: '_id',
        asField: 'company', oneToOneCardinality: true
      });
    }
    // Site
    if (params.withSite) {
      DatabaseUtils.pushSiteLookupInAggregation({
        tenantID, aggregation: aggregation, localField: 'siteID', foreignField: '_id',
        asField: 'site', oneToOneCardinality: true
      });
    }
    // Site Area
    if (params.withSiteArea) {
      DatabaseUtils.pushSiteAreaLookupInAggregation({
        tenantID, aggregation: aggregation, localField: 'siteAreaID', foreignField: '_id',
        asField: 'siteArea', oneToOneCardinality: true
      });
    }
    // Charging Station
    if (params.withChargingStation) {
      DatabaseUtils.pushChargingStationLookupInAggregation({
        tenantID, aggregation: aggregation, localField: 'chargeBoxID', foreignField: '_id',
        asField: 'chargeBox', oneToOneCardinality: true, oneToOneCardinalityNotNull: false
      });
      DatabaseUtils.pushConvertObjectIDToString(aggregation, 'chargeBox.siteAreaID');
      // Add Connector and Status
      if (projectFields && projectFields.includes('status')) {
        aggregation.push({
          $addFields: {
            connector: {
              $arrayElemAt: [
                '$chargeBox.connectors', {
                  $indexOfArray: ['$chargeBox.connectors.connectorId', '$connectorId']
                }
              ]
            }
          }
        }, {
          $addFields: { status: '$connector.status' }
        });
      }
    }
    // User
    if (params.withUser) {
      DatabaseUtils.pushUserLookupInAggregation({
        tenantID, aggregation: aggregation, asField: 'user', localField: 'userID',
        foreignField: '_id', oneToOneCardinality: true, oneToOneCardinalityNotNull: false
      });
      DatabaseUtils.pushUserLookupInAggregation({
        tenantID, aggregation: aggregation, asField: 'stop.user', localField: 'stop.userID',
        foreignField: '_id', oneToOneCardinality: true, oneToOneCardinalityNotNull: false
      });
    }
    // Car
    if (params.withCar) {
      DatabaseUtils.pushCarLookupInAggregation({
        tenantID, aggregation: aggregation, asField: 'car', localField: 'carID',
        foreignField: '_id', oneToOneCardinality: true, oneToOneCardinalityNotNull: false
      });
      DatabaseUtils.pushCarCatalogLookupInAggregation({
        tenantID: Constants.DEFAULT_TENANT, aggregation: aggregation, asField: 'carCatalog', localField: 'carCatalogID',
        foreignField: '_id', oneToOneCardinality: true
      });
    }
    // Rename ID
    DatabaseUtils.pushRenameDatabaseIDToNumber(aggregation);
    // Convert Object ID to string
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'userID');
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'siteID');
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'siteAreaID');
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'stop.userID');
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'remotestop.userID');
    // Set to null
    DatabaseUtils.clearFieldValueIfSubFieldIsNull(aggregation, 'stop', 'timestamp');
    DatabaseUtils.clearFieldValueIfSubFieldIsNull(aggregation, 'remotestop', 'timestamp');
    // Project
    DatabaseUtils.projectFields(aggregation, projectFields);
    // Read DB
    const transactionsMDB = await global.database.getCollection<Transaction>(tenantID, 'transactions')
      .aggregate(aggregation, {
        allowDiskUse: true
      })
      .toArray();
    // Debug
    await Logging.traceEnd(tenantID, MODULE_NAME, 'getTransactions', uniqueTimerID, transactionsMDB);
    return {
      count: transactionCountMDB ? (transactionCountMDB.count === Constants.DB_RECORD_COUNT_CEIL ? -1 : transactionCountMDB.count) : 0,
      stats: transactionCountMDB ? transactionCountMDB : {},
      result: transactionsMDB
    };
  }

  public static async getRefundReports(tenantID: string,
      params: { ownerID?: string; siteAdminIDs?: string[] },
      dbParams: DbParams, projectFields?: string[]): Promise<{ count: number; result: RefundReport[] }> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenantID, MODULE_NAME, 'getTransactions');
    // Check
    await DatabaseUtils.checkTenant(tenantID);
    // Clone before updating the values
    dbParams = Utils.cloneObject(dbParams);
    // Check Limit
    dbParams.limit = Utils.checkRecordLimit(dbParams.limit);
    // Check Skip
    dbParams.skip = Utils.checkRecordSkip(dbParams.skip);
    // Create Aggregation
    const aggregation = [];
    const ownerMatch = { $or: [] };
    const filters = {};
    filters['refundData.reportId'] = { '$ne': null };
    if (params.ownerID) {
      ownerMatch.$or.push({
        userID: DatabaseUtils.convertToObjectID(params.ownerID)
      });
    }
    if (params.siteAdminIDs) {
      ownerMatch.$or.push({
        siteID: {
          $in: params.siteAdminIDs.map((siteID) => DatabaseUtils.convertToObjectID(siteID))
        }
      });
    }
    if (ownerMatch.$or && ownerMatch.$or.length > 0) {
      aggregation.push({
        $match: {
          $and: [
            ownerMatch, filters
          ]
        }
      });
    } else {
      aggregation.push({
        $match: filters
      });
    }
    aggregation.push({
      $group: {
        '_id': '$refundData.reportId',
        'userID': { '$first': '$userID' }
      }
    });
    // Limit records?
    if (!dbParams.onlyRecordCount) {
      // Always limit the nbr of record to avoid perfs issues
      aggregation.push({ $limit: Constants.DB_RECORD_COUNT_CEIL });
    }
    // Prepare statistics query
    const statsQuery = {
      $group: {
        _id: null,
        count: { $sum: 1 }
      }
    };
    // Count Records
    const transactionsCountMDB = await global.database.getCollection<any>(tenantID, 'transactions')
      .aggregate([...aggregation, statsQuery], { allowDiskUse: true })
      .toArray();
    let reportCountMDB = (transactionsCountMDB && transactionsCountMDB.length > 0) ? transactionsCountMDB[0] : null;
    // Initialize statistics
    if (!reportCountMDB) {
      reportCountMDB = {
        count: 0
      };
    }
    // Check if only the total count is requested
    if (dbParams.onlyRecordCount) {
      await Logging.traceEnd(tenantID, MODULE_NAME, 'getRefundReports', uniqueTimerID, reportCountMDB);
      return {
        count: reportCountMDB ? reportCountMDB.count : 0,
        result: []
      };
    }
    // Remove the limit
    aggregation.pop();
    // Not yet possible to remove the fields if stop/remoteStop does not exist (MongoDB 4.2)
    // DatabaseUtils.pushConvertObjectIDToString(aggregation, 'stop.userID');
    // DatabaseUtils.pushConvertObjectIDToString(aggregation, 'remotestop.userID');
    // Sort
    if (!dbParams.sort) {
      dbParams.sort = { timestamp: -1 };
    }
    if (!dbParams.sort.timestamp) {
      aggregation.push({
        $sort: { ...dbParams.sort, timestamp: -1 }
      });
    } else {
      aggregation.push({
        $sort: dbParams.sort
      });
    }
    // Skip
    aggregation.push({
      $skip: dbParams.skip
    });
    // Limit
    aggregation.push({
      $limit: dbParams.limit
    });
    // Add respective users
    DatabaseUtils.pushUserLookupInAggregation({
      tenantID, aggregation: aggregation, asField: 'user', localField: 'userID',
      foreignField: '_id', oneToOneCardinality: true, oneToOneCardinalityNotNull: false
    });
    // Rename ID
    DatabaseUtils.pushRenameDatabaseIDToNumber(aggregation);
    // Convert Object ID to string
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'userID');
    // Project
    DatabaseUtils.projectFields(aggregation, projectFields);
    // Read DB
    const reportsMDB = await global.database.getCollection<RefundReport>(tenantID, 'transactions')
      .aggregate(aggregation, {
        allowDiskUse: true
      })
      .toArray();
    // Debug
    await Logging.traceEnd(tenantID, MODULE_NAME, 'getRefundReports', uniqueTimerID, reportsMDB);
    return {
      count: reportCountMDB ? (reportCountMDB.count === Constants.DB_RECORD_COUNT_CEIL ? -1 : reportCountMDB.count) : 0,
      result: reportsMDB
    };
  }

  static async getTransactionsInError(tenantID: string,
      params: {
        search?: string; issuer?: boolean; userIDs?: string[]; chargingStationIDs?: string[];
        siteAreaIDs?: string[]; siteIDs?: string[]; startDateTime?: Date; endDateTime?: Date;
        withChargingStations?: boolean; errorType?: TransactionInErrorType[]; connectorIDs?: number[];
      }, dbParams: DbParams, projectFields?: string[]): Promise<DataResult<TransactionInError>> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenantID, MODULE_NAME, 'getTransactionsInError');
    // Check
    await DatabaseUtils.checkTenant(tenantID);
    // Clone before updating the values
    dbParams = Utils.cloneObject(dbParams);
    // Check Limit
    dbParams.limit = Utils.checkRecordLimit(dbParams.limit);
    // Check Skip
    dbParams.skip = Utils.checkRecordSkip(dbParams.skip);
    // Build filters
    const match: any = { stop: { $exists: true } };
    // Filter?
    if (params.search) {
      match.$or = [
        { '_id': Utils.convertToInt(params.search) },
        { 'tagID': { $regex: params.search, $options: 'i' } },
        { 'chargeBoxID': { $regex: params.search, $options: 'i' } }
      ];
    }
    // Issuer
    if (Utils.objectHasProperty(params, 'issuer') && Utils.isBoolean(params.issuer)) {
      match.issuer = params.issuer;
    }
    // User / Site Admin
    if (params.userIDs) {
      match.userID = { $in: params.userIDs.map((user) => DatabaseUtils.convertToObjectID(user)) };
    }
    // Charge Box
    if (params.chargingStationIDs) {
      match.chargeBoxID = { $in: params.chargingStationIDs };
    }
    // Date provided?
    if (params.startDateTime || params.endDateTime) {
      match.timestamp = {};
    }
    // Start date
    if (params.startDateTime) {
      match.timestamp.$gte = Utils.convertToDate(params.startDateTime);
    }
    // End date
    if (params.endDateTime) {
      match.timestamp.$lte = Utils.convertToDate(params.endDateTime);
    }
    // Site Areas
    if (params.siteAreaIDs) {
      match.siteAreaID = {
        $in: params.siteAreaIDs.map((area) => DatabaseUtils.convertToObjectID(area))
      };
    }
    // Sites
    if (params.siteIDs) {
      match.siteID = {
        $in: params.siteIDs.map((site) => DatabaseUtils.convertToObjectID(site))
      };
    }
    // Connectors
    if (!Utils.isEmptyArray(params.connectorIDs)) {
      match.connectorId = {
        $in: params.connectorIDs.map((connectorID) => DatabaseUtils.convertToObjectID(connectorID))
      };
    }
    // Create Aggregation
    const aggregation = [];
    aggregation.push({
      $match: match
    });
    // Charging Station
    if (params.withChargingStations ||
      (params.errorType && params.errorType.includes(TransactionInErrorType.OVER_CONSUMPTION))) {
      // Add Charge Box
      DatabaseUtils.pushChargingStationLookupInAggregation({
        tenantID, aggregation: aggregation, localField: 'chargeBoxID', foreignField: '_id', asField: 'chargeBox',
        oneToOneCardinality: true, oneToOneCardinalityNotNull: false, pipelineMatch: { 'issuer': true }
      });
      DatabaseUtils.pushConvertObjectIDToString(aggregation, 'chargeBox.siteAreaID');
    }
    // User
    DatabaseUtils.pushUserLookupInAggregation({
      tenantID, aggregation: aggregation, asField: 'user', localField: 'userID',
      foreignField: '_id', oneToOneCardinality: true, oneToOneCardinalityNotNull: false
    });
    // Car Catalog
    DatabaseUtils.pushCarCatalogLookupInAggregation({
      tenantID: Constants.DEFAULT_TENANT, aggregation: aggregation, asField: 'carCatalog', localField: 'carCatalogID',
      foreignField: '_id', oneToOneCardinality: true
    });
    // Used only in the error type : missing_user
    if (params.errorType && params.errorType.includes(TransactionInErrorType.MISSING_USER)) {
      // Site Area
      DatabaseUtils.pushSiteAreaLookupInAggregation({
        tenantID, aggregation: aggregation, localField: 'siteAreaID', foreignField: '_id',
        asField: 'siteArea', oneToOneCardinality: true
      });
    }
    // Build facets for each type of error if any
    if (!Utils.isEmptyArray(params.errorType)) {
      const facets: any = { $facet: {} };
      const array = [];
      for (const type of params.errorType) {
        array.push(`$${type}`);
        facets.$facet[type] = TransactionStorage.getTransactionsInErrorFacet(type);
      }
      aggregation.push(facets);
      // Manipulate the results to convert it to an array of document on root level
      aggregation.push({ $project: { 'allItems': { $setUnion: array } } });
      aggregation.push({ $unwind: { 'path': '$allItems' } });
      aggregation.push({ $replaceRoot: { newRoot: '$allItems' } });
      // Add a unique identifier as we may have the same Charging Station several time
      aggregation.push({ $addFields: { 'uniqueId': { $concat: [{ $substr: ['$_id', 0, -1] }, '#', '$errorCode'] } } });
    }
    // Users
    DatabaseUtils.pushUserLookupInAggregation({
      tenantID, aggregation: aggregation, asField: 'stop.user', localField: 'stop.userID',
      foreignField: '_id', oneToOneCardinality: true, oneToOneCardinalityNotNull: false
    });
    // Rename ID
    DatabaseUtils.pushRenameDatabaseIDToNumber(aggregation);
    // Convert Object ID to string
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'userID');
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'siteID');
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'siteAreaID');
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'stop.userID');
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'remotestop.userID');
    // Set to null
    DatabaseUtils.clearFieldValueIfSubFieldIsNull(aggregation, 'stop', 'timestamp');
    DatabaseUtils.clearFieldValueIfSubFieldIsNull(aggregation, 'remotestop', 'timestamp');
    // Sort
    if (!dbParams.sort) {
      dbParams.sort = { _id: 1 };
    }
    aggregation.push({
      $sort: dbParams.sort
    });
    // Skip
    aggregation.push({
      $skip: dbParams.skip
    });
    // Limit
    aggregation.push({
      $limit: dbParams.limit
    });
    // Project
    DatabaseUtils.projectFields(aggregation, projectFields);
    // Read DB
    const transactionsMDB = await global.database.getCollection<TransactionInError>(tenantID, 'transactions')
      .aggregate(aggregation, {
        allowDiskUse: true
      })
      .toArray();
    // Debug
    await Logging.traceEnd(tenantID, MODULE_NAME, 'getTransactionsInError', uniqueTimerID, transactionsMDB);
    return {
      count: transactionsMDB.length,
      result: transactionsMDB
    };
  }

  public static async getTransaction(tenantID: string, id: number = Constants.UNKNOWN_NUMBER_ID,
      params: { withTag?: boolean; withCar?: boolean; withUser?: boolean, withChargingStation?: boolean } = {}, projectFields?: string[]): Promise<Transaction> {
    const transactionsMDB = await TransactionStorage.getTransactions(tenantID, {
      transactionIDs: [id],
      withTag: params.withTag,
      withCar: params.withCar,
      withChargingStation: params.withChargingStation,
      withUser: params.withUser,
    }, Constants.DB_PARAMS_SINGLE_RECORD, projectFields);
    return transactionsMDB.count === 1 ? transactionsMDB.result[0] : null;
  }

  public static async getOCPITransactionBySessionID(tenantID: string, sessionID: string): Promise<Transaction> {
    const transactionsMDB = await TransactionStorage.getTransactions(tenantID,
      {
        ocpiSessionID: sessionID
      }, Constants.DB_PARAMS_SINGLE_RECORD);
    return transactionsMDB.count === 1 ? transactionsMDB.result[0] : null;
  }

  public static async getOCPITransactionByAuthorizationID(tenantID: string, authorizationID: string): Promise<Transaction> {
    const transactionsMDB = await TransactionStorage.getTransactions(tenantID,
      {
        ocpiAuthorizationID: authorizationID
      }, Constants.DB_PARAMS_SINGLE_RECORD);
    return transactionsMDB.count === 1 ? transactionsMDB.result[0] : null;
  }

  public static async getOICPTransactionBySessionID(tenantID: string, oicpSessionID: string): Promise<Transaction> {
    const transactionsMDB = await TransactionStorage.getTransactions(tenantID,
      {
        oicpSessionID: oicpSessionID
      }, Constants.DB_PARAMS_SINGLE_RECORD);
    return transactionsMDB.count === 1 ? transactionsMDB.result[0] : null;
  }

  public static async getActiveTransaction(tenantID: string, chargeBoxID: string, connectorId: number): Promise<Transaction> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenantID, MODULE_NAME, 'getActiveTransaction');
    // Check
    await DatabaseUtils.checkTenant(tenantID);
    const aggregation = [];
    // Filters
    aggregation.push({
      $match: {
        'chargeBoxID': chargeBoxID,
        'connectorId': Utils.convertToInt(connectorId),
        'stop': { $exists: false }
      }
    });
    // Add User
    DatabaseUtils.pushUserLookupInAggregation({
      tenantID, aggregation, localField: 'userID', foreignField: '_id', asField: 'user',
      oneToOneCardinality: true, oneToOneCardinalityNotNull: false
    });
    // Rename ID
    DatabaseUtils.pushRenameDatabaseIDToNumber(aggregation);
    // Convert Object ID to string
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'userID');
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'siteID');
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'siteAreaID');
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'stop.userID');
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'remotestop.userID');
    // Set to null
    DatabaseUtils.clearFieldValueIfSubFieldIsNull(aggregation, 'stop', 'timestamp');
    DatabaseUtils.clearFieldValueIfSubFieldIsNull(aggregation, 'remotestop', 'timestamp');
    // Read DB
    const transactionsMDB = await global.database.getCollection<Transaction>(tenantID, 'transactions')
      .aggregate(aggregation, { allowDiskUse: true })
      .toArray();
    // Debug
    await Logging.traceEnd(tenantID, MODULE_NAME, 'getActiveTransaction', uniqueTimerID, transactionsMDB);
    return transactionsMDB.length === 1 ? transactionsMDB[0] : null;
  }

  public static async getLastTransactionFromChargingStation(tenantID: string, chargeBoxID: string, connectorId: number,
      params: { withChargingStation?: boolean; withUser?: boolean; withTag: boolean; }): Promise<Transaction> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenantID, MODULE_NAME, 'getLastTransaction');
    // Check
    await DatabaseUtils.checkTenant(tenantID);
    const aggregation = [];
    // Filters
    aggregation.push({
      $match: {
        'chargeBoxID': chargeBoxID,
        'connectorId': Utils.convertToInt(connectorId)
      }
    });
    // Sort
    aggregation.push({
      $sort: {
        timestamp: -1
      }
    });
    // The last one
    aggregation.push({
      $limit: 1
    });
    // Add Charging Station
    if (params.withChargingStation) {
      DatabaseUtils.pushChargingStationLookupInAggregation({
        tenantID, aggregation: aggregation, localField: 'chargeBoxID', foreignField: '_id',
        asField: 'chargeBox', oneToOneCardinality: true, oneToOneCardinalityNotNull: false
      });
    }
    // Add User
    if (params.withUser) {
      DatabaseUtils.pushUserLookupInAggregation({
        tenantID, aggregation: aggregation, localField: 'userID', foreignField: '_id',
        asField: 'user', oneToOneCardinality: true, oneToOneCardinalityNotNull: false
      });
    }
    // Tag
    if (params.withTag) {
      DatabaseUtils.pushTagLookupInAggregation({
        tenantID, aggregation: aggregation, asField: 'tag', localField: 'tagID',
        foreignField: '_id', oneToOneCardinality: true
      });
    }
    // Rename ID
    DatabaseUtils.pushRenameDatabaseIDToNumber(aggregation);
    // Convert Object ID to string
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'userID');
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'siteID');
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'siteAreaID');
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'stop.userID');
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'remotestop.userID');
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'chargeBox.siteAreaID');
    // Set to null
    DatabaseUtils.clearFieldValueIfSubFieldIsNull(aggregation, 'stop', 'timestamp');
    DatabaseUtils.clearFieldValueIfSubFieldIsNull(aggregation, 'remotestop', 'timestamp');
    // Read DB
    const transactionsMDB = await global.database.getCollection<Transaction>(tenantID, 'transactions')
      .aggregate(aggregation, { allowDiskUse: true })
      .toArray();
    // Debug
    await Logging.traceEnd(tenantID, MODULE_NAME, 'getLastTransaction', uniqueTimerID, transactionsMDB);
    return transactionsMDB.length === 1 ? transactionsMDB[0] : null;
  }

  public static async findAvailableID(tenantID: string): Promise<number> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenantID, MODULE_NAME, '_findAvailableID');
    // Check
    await DatabaseUtils.checkTenant(tenantID);
    let existingTransaction: Transaction;
    do {
      // Generate new transaction ID
      const id = Utils.getRandomIntSafe();
      existingTransaction = await TransactionStorage.getTransaction(tenantID, id);
      if (existingTransaction) {
        await Logging.logWarning({
          tenantID: tenantID,
          module: MODULE_NAME, method: '_findAvailableID',
          action: ServerAction.TRANSACTION_STARTED,
          message: `Transaction ID '${id}' already exists, generating a new one...`
        });
      } else {
        return id;
      }
    } while (existingTransaction);
    // Debug
    await Logging.traceEnd(tenantID, MODULE_NAME, '_findAvailableID', uniqueTimerID);
  }

  public static async getNotStartedTransactions(tenantID: string,
      params: { checkPastAuthorizeMins: number; sessionShouldBeStartedAfterMins: number }): Promise<DataResult<NotifySessionNotStarted>> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenantID, MODULE_NAME, 'getNotStartedTransactions');
    // Check Tenant
    await DatabaseUtils.checkTenant(tenantID);
    // Compute the date some minutes ago
    const authorizeStartDate = moment().subtract(params.checkPastAuthorizeMins, 'minutes').toDate();
    const authorizeEndDate = moment().subtract(params.sessionShouldBeStartedAfterMins, 'minutes').toDate();
    // Create Aggregation
    const aggregation = [];
    // Authorization window
    aggregation.push({
      $match: {
        timestamp: {
          $gt: Utils.convertToDate(authorizeStartDate),
          $lt: Utils.convertToDate(authorizeEndDate)
        }
      }
    });
    // Group by tagID
    aggregation.push({
      $group: {
        _id: '$tagID',
        authDate: {
          $last: '$timestamp'
        },
        chargeBoxID: {
          $last: '$chargeBoxID'
        },
        userID: {
          $last: '$userID'
        }
      }
    });
    // Add number of mins
    aggregation.push({
      $addFields: {
        dateStart: {
          $toDate: { $subtract: [{ $toLong: '$authDate' }, 5 * 60 * 1000] }
        },
        dateEnd: {
          $toDate: { $add: [{ $toLong: '$authDate' }, params.sessionShouldBeStartedAfterMins * 60 * 1000] }
        }
      }
    });
    // Lookup for transactions
    aggregation.push({
      $lookup: {
        from: DatabaseUtils.getCollectionName(tenantID, 'transactions'),
        let: { tagID: '$_id', dateStart: '$dateStart', dateEnd: '$dateEnd' },
        pipeline: [{
          $match: {
            $or: [
              {
                $and: [
                  { $expr: { $eq: ['$tagID', '$$tagID'] } },
                  { $expr: { $gt: ['$timestamp', '$$dateStart'] } },
                  { $expr: { $lt: ['$timestamp', '$$dateEnd'] } }
                ]
              },
              {
                $and: [
                  { $expr: { $eq: ['$stop.tagID', '$$tagID'] } },
                  { $expr: { $gt: ['$stop.timestamp', '$$dateStart'] } },
                  { $expr: { $lt: ['$stop.timestamp', '$$dateEnd'] } }
                ]
              },
            ]
          }
        }],
        as: 'transaction'
      }
    });
    // Get only authorize with no transactions
    aggregation.push({
      $match: {
        transaction: { $size: 0 }
      }
    });
    // Lookup for users
    DatabaseUtils.pushUserLookupInAggregation({
      tenantID, aggregation, localField: 'userID', foreignField: '_id',
      asField: 'user', oneToOneCardinality: true, oneToOneCardinalityNotNull: true
    });
    // Lookup for charging station
    DatabaseUtils.pushChargingStationLookupInAggregation({
      tenantID, aggregation, localField: 'chargeBoxID', foreignField: '_id',
      asField: 'chargingStation', oneToOneCardinality: true, oneToOneCardinalityNotNull: true
    });
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'chargingStation.siteAreaID');
    // Format Data
    aggregation.push({
      $project: {
        _id: 0,
        tagID: '$_id',
        authDate: '$dateStart',
        chargingStation: 1,
        user: 1
      }
    });
    // Read DB
    const notifySessionNotStartedMDB: NotifySessionNotStarted[] =
      await global.database.getCollection<NotifySessionNotStarted>(tenantID, 'authorizes')
        .aggregate(aggregation, {
          allowDiskUse: true
        })
        .toArray();
    // Debug
    await Logging.traceEnd(tenantID, MODULE_NAME, 'getNotStartedTransactions', uniqueTimerID, notifySessionNotStartedMDB);
    return {
      count: notifySessionNotStartedMDB.length,
      result: notifySessionNotStartedMDB
    };
  }

  private static getTransactionsInErrorFacet(errorType: string) {
    switch (errorType) {
      case TransactionInErrorType.LONG_INACTIVITY:
        return [
          { $addFields: { 'totalInactivity': { $add: ['$stop.totalInactivitySecs', '$stop.extraInactivitySecs'] } } },
          { $match: { 'totalInactivity': { $gte: 86400 } } },
          { $addFields: { 'errorCode': TransactionInErrorType.LONG_INACTIVITY } }
        ];
      case TransactionInErrorType.NO_CONSUMPTION:
        return [
          { $match: { 'stop.totalConsumptionWh': { $eq: 0 } } },
          { $addFields: { 'errorCode': TransactionInErrorType.NO_CONSUMPTION } }
        ];
      case TransactionInErrorType.LOW_CONSUMPTION:
        return [
          { $match: { 'stop.totalConsumptionWh': { $gt: 0, $lt: 1000 } } },
          { $addFields: { 'errorCode': TransactionInErrorType.LOW_CONSUMPTION } }
        ];
      case TransactionInErrorType.NEGATIVE_ACTIVITY:
        return [
          {
            $match: {
              $or: [
                { 'stop.totalInactivitySecs': { $lt: 0 } },
                { 'stop.extraInactivitySecs': { $lt: 0 } },
              ]
            }
          },
          { $addFields: { 'errorCode': TransactionInErrorType.NEGATIVE_ACTIVITY } }
        ];
      case TransactionInErrorType.NEGATIVE_DURATION:
        return [
          { $match: { 'stop.totalDurationSecs': { $lt: 0 } } },
          { $addFields: { 'errorCode': TransactionInErrorType.NEGATIVE_DURATION } }
        ];
      case TransactionInErrorType.LOW_DURATION:
        return [
          { $match: { 'stop.totalDurationSecs': { $gte: 0, $lt: 60 } } },
          { $addFields: { 'errorCode': TransactionInErrorType.LOW_DURATION } }
        ];
      case TransactionInErrorType.INVALID_START_DATE:
        return [
          { $match: { 'timestamp': { $lte: Utils.convertToDate('2017-01-01 00:00:00.000Z') } } },
          { $addFields: { 'errorCode': TransactionInErrorType.INVALID_START_DATE } }
        ];
      case TransactionInErrorType.OVER_CONSUMPTION:
        return [
          { $addFields: { activeDuration: { $subtract: ['$stop.totalDurationSecs', '$stop.totalInactivitySecs'] } } },
          { $match: { 'activeDuration': { $gt: 0 } } },
          { $addFields: { connector: { $arrayElemAt: ['$chargeBox.connectors', { $subtract: ['$connectorId', 1] }] } } },
          { $addFields: { averagePower: { $abs: { $multiply: [{ $divide: ['$stop.totalConsumptionWh', '$activeDuration'] }, 3600] } } } },
          { $addFields: { impossiblePower: { $lte: [{ $subtract: [{ $multiply: ['$connector.power', 1.10] }, '$averagePower'] }, 0] } } },
          { $match: { 'impossiblePower': { $eq: true } } },
          { $addFields: { 'errorCode': TransactionInErrorType.OVER_CONSUMPTION } }
        ];
      case TransactionInErrorType.MISSING_PRICE:
        return [
          { $match: { 'stop.price': { $lte: 0 } } },
          { $match: { 'stop.totalConsumptionWh': { $gt: 0 } } },
          { $addFields: { 'errorCode': TransactionInErrorType.MISSING_PRICE } }
        ];
      case TransactionInErrorType.MISSING_USER:
        return [
          {
            $match: {
              'userID': null,
            }
          },
          { $addFields: { 'errorCode': TransactionInErrorType.MISSING_USER } }
        ];
      case TransactionInErrorType.NO_BILLING_DATA:
        return [
          {
            $match: {
              $and: [
                { 'billingData.withBillingActive': { $eq: true } },
                {
                  $or: [
                    { 'billingData': { $exists: false } },
                    { 'billingData.stop': { $exists: false } },
                    { 'billingData.stop.status': { $eq: BillingStatus.FAILED } },
                  ]
                }
              ]
            }
          },
          { $addFields: { 'errorCode': TransactionInErrorType.NO_BILLING_DATA } }
        ];
      default:
        return [];
    }
  }
}
