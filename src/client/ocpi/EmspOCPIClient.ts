import { OCPIToken, OCPITokenWhitelist } from '../../types/ocpi/OCPIToken';

import BackendError from '../../exception/BackendError';
import ChargingStation from '../../types/ChargingStation';
import ChargingStationStorage from '../../storage/mongodb/ChargingStationStorage';
import Company from '../../types/Company';
import CompanyStorage from '../../storage/mongodb/CompanyStorage';
import Constants from '../../utils/Constants';
import { DataResult } from '../../types/DataResult';
import Logging from '../../utils/Logging';
import { OCPICdr } from '../../types/ocpi/OCPICdr';
import OCPIClient from './OCPIClient';
import { OCPICommandResponse } from '../../types/ocpi/OCPICommandResponse';
import { OCPICommandType } from '../../types/ocpi/OCPICommandType';
import OCPIEndpoint from '../../types/ocpi/OCPIEndpoint';
import OCPIEndpointStorage from '../../storage/mongodb/OCPIEndpointStorage';
import { OCPIEvseStatus } from '../../types/ocpi/OCPIEvse';
import { OCPILocation } from '../../types/ocpi/OCPILocation';
import { OCPIResult } from '../../types/ocpi/OCPIResult';
import { OCPIRole } from '../../types/ocpi/OCPIRole';
import { OCPISession } from '../../types/ocpi/OCPISession';
import { OCPIStartSession } from '../../types/ocpi/OCPIStartSession';
import { OCPIStopSession } from '../../types/ocpi/OCPIStopSession';
import OCPIUtils from '../../server/ocpi/OCPIUtils';
import OCPIUtilsService from '../../server/ocpi/ocpi-services-impl/ocpi-2.1.1/OCPIUtilsService';
import { OcpiSetting } from '../../types/Setting';
import { ServerAction } from '../../types/Server';
import Site from '../../types/Site';
import SiteArea from '../../types/SiteArea';
import SiteAreaStorage from '../../storage/mongodb/SiteAreaStorage';
import SiteStorage from '../../storage/mongodb/SiteStorage';
import TagStorage from '../../storage/mongodb/TagStorage';
import Tenant from '../../types/Tenant';
import TransactionStorage from '../../storage/mongodb/TransactionStorage';
import Utils from '../../utils/Utils';
import _ from 'lodash';
import moment from 'moment';

const MODULE_NAME = 'EmspOCPIClient';

export default class EmspOCPIClient extends OCPIClient {
  public constructor(tenant: Tenant, settings: OcpiSetting, ocpiEndpoint: OCPIEndpoint) {
    super(tenant, settings, ocpiEndpoint, OCPIRole.EMSP);
    if (ocpiEndpoint.role !== OCPIRole.EMSP) {
      throw new BackendError({
        message: `EmspOCPIClient requires OCPI Endpoint with role ${OCPIRole.EMSP}`,
        module: MODULE_NAME, method: 'constructor',
      });
    }
  }

  public async pushTokens(): Promise<OCPIResult> {
    // Result
    const result: OCPIResult = {
      success: 0,
      failure: 0,
      total: 0,
      logs: [],
      objectIDsInFailure: [],
    };
    // Perfs trace
    const startTime = new Date().getTime();
    // Get timestamp before starting process - to be saved in DB at the end of the process
    const lastPatchJobOn = new Date();
    let currentSkip = 0;
    let tokens: DataResult<OCPIToken>;
    do {
      // Get all tokens
      tokens = await OCPIUtilsService.getTokens(
        this.tenant, Constants.DB_RECORD_COUNT_DEFAULT, currentSkip);
      if (!Utils.isEmptyArray(tokens.result)) {
        await Promise.map(tokens.result, async (token: OCPIToken) => {
          result.total++;
          try {
            await this.pushToken(token);
            result.success++;
          } catch (error) {
            result.failure++;
            result.objectIDsInFailure.push(token.uid);
            result.logs.push(
              `Failed to update Token ID '${token.uid}': ${error.message}`
            );
          }
        },
        { concurrency: Constants.OCPI_MAX_PARALLEL_REQUESTS });
      }
      currentSkip += Constants.DB_RECORD_COUNT_DEFAULT;
    } while (!Utils.isEmptyArray(tokens.result));
    // Save result in ocpi endpoint
    this.ocpiEndpoint.lastPatchJobOn = lastPatchJobOn;
    // Set result
    if (result) {
      this.ocpiEndpoint.lastPatchJobResult = {
        'successNbr': result.success,
        'failureNbr': result.failure,
        'totalNbr': result.total,
        'tokenIDsInFailure': _.uniq(result.objectIDsInFailure),
      };
    } else {
      this.ocpiEndpoint.lastPatchJobResult = {
        'successNbr': 0,
        'failureNbr': 0,
        'totalNbr': 0,
        'tokenIDsInFailure': [],
      };
    }
    // Save
    await OCPIEndpointStorage.saveOcpiEndpoint(this.tenant, this.ocpiEndpoint);
    const executionDurationSecs = (new Date().getTime() - startTime) / 1000;
    await Logging.logOcpiResult(this.tenant.id, ServerAction.OCPI_PUSH_TOKENS,
      MODULE_NAME, 'sendTokens', result,
      `{{inSuccess}} Token(s) were successfully pushed in ${executionDurationSecs}s`,
      `{{inError}} Token(s) failed to be pushed in ${executionDurationSecs}s`,
      `{{inSuccess}} Token(s) were successfully pushed and {{inError}} failed to be pushed in ${executionDurationSecs}s`,
      'No Tokens have been pushed'
    );
    return result;
  }

  public async checkAndGetCompany(): Promise<Company> {
    let company = await CompanyStorage.getCompany(this.tenant, this.ocpiEndpoint.id);
    if (!company) {
      company = {
        id: this.ocpiEndpoint.id,
        name: this.ocpiEndpoint.name,
        issuer: false,
        createdOn: new Date()
      } as Company;
      await CompanyStorage.saveCompany(this.tenant, company, false);
    }
    return company;
  }

  public async pullLocations(partial = true): Promise<OCPIResult> {
    // Result
    const result: OCPIResult = {
      success: 0,
      failure: 0,
      total: 0,
      logs: []
    };
    // Perfs trace
    const startTime = new Date().getTime();
    // Get locations endpoint url
    let locationsUrl = this.getEndpointUrl('locations', ServerAction.OCPI_PULL_LOCATIONS);
    if (partial) {
      // Take the last day
      const momentFrom = moment().utc().subtract(1, 'days').startOf('day');
      locationsUrl = `${locationsUrl}?date_from=${momentFrom.format()}&limit=5`;
    } else {
      // Take them all
      locationsUrl = `${locationsUrl}?limit=5`;
    }
    const company = await this.checkAndGetCompany();
    const sites = await SiteStorage.getSites(this.tenant,
      { companyIDs: [ company.id ] }, Constants.DB_PARAMS_MAX_LIMIT);
    let nextResult = true;
    do {
      // Call IOP
      const response = await this.axiosInstance.get(
        locationsUrl,
        {
          headers: {
            Authorization: `Token ${this.ocpiEndpoint.token}`
          },
        });
      const locations = response.data.data as OCPILocation[];
      if (!Utils.isEmptyArray(locations)) {
        // Cannot process locations in parallel (uniqueness is on site name) -> leads to dups
        for (const location of locations) {
          try {
            await this.processLocation(location, company, sites.result);
            result.success++;
          } catch (error) {
            result.failure++;
            result.logs.push(
              `Failed to update Location '${location.name}': ${error.message}`
            );
          }
        }
      }
      const nextUrl = OCPIUtils.getNextUrl(response.headers.link);
      if (nextUrl && nextUrl.length > 0 && nextUrl !== locationsUrl) {
        locationsUrl = nextUrl;
      } else {
        nextResult = false;
      }
    } while (nextResult);
    const executionDurationSecs = (new Date().getTime() - startTime) / 1000;
    await Logging.logOcpiResult(this.tenant.id, ServerAction.OCPI_PULL_LOCATIONS,
      MODULE_NAME, 'pullLocations', result,
      `{{inSuccess}} Location(s) were successfully pulled in ${executionDurationSecs}s`,
      `{{inError}} Location(s) failed to be pulled in ${executionDurationSecs}s`,
      `{{inSuccess}} Location(s) were successfully pulled and {{inError}} failed to be pulled in ${executionDurationSecs}s`,
      'No Locations have been pulled'
    );
    return result;
  }

  public async pullSessions(): Promise<OCPIResult> {
    // Result
    const result: OCPIResult = {
      success: 0,
      failure: 0,
      total: 0,
      logs: []
    };
    // Perfs trace
    const startTime = new Date().getTime();
    // Get sessions endpoint url
    let sessionsUrl = this.getEndpointUrl('sessions', ServerAction.OCPI_PULL_SESSIONS);
    const momentFrom = moment().utc().subtract(2, 'days').startOf('day');
    sessionsUrl = `${sessionsUrl}?date_from=${momentFrom.format()}&limit=10`;
    let nextResult = true;
    do {
      // Call IOP
      const response = await this.axiosInstance.get(
        sessionsUrl,
        {
          headers: {
            Authorization: `Token ${this.ocpiEndpoint.token}`
          },
        });
      const sessions = response.data.data as OCPISession[];
      if (!Utils.isEmptyArray(sessions)) {
        await Promise.map(sessions, async (session: OCPISession) => {
          try {
            await OCPIUtilsService.updateTransaction(this.tenant, session);
            result.success++;
          } catch (error) {
            result.failure++;
            result.logs.push(
              `Failed to update OCPI Session ID '${session.id}': ${error.message}`
            );
          }
        },
        { concurrency: Constants.OCPI_MAX_PARALLEL_REQUESTS });
      }
      const nextUrl = OCPIUtils.getNextUrl(response.headers.link);
      if (nextUrl && nextUrl.length > 0 && nextUrl !== sessionsUrl) {
        sessionsUrl = nextUrl;
      } else {
        nextResult = false;
      }
    } while (nextResult);
    result.total = result.failure + result.success;
    const executionDurationSecs = (new Date().getTime() - startTime) / 1000;
    await Logging.logOcpiResult(this.tenant.id, ServerAction.OCPI_PULL_SESSIONS,
      MODULE_NAME, 'pullSessions', result,
      `{{inSuccess}} Session(s) were successfully pulled in ${executionDurationSecs}s`,
      `{{inError}} Session(s) failed to be pulled in ${executionDurationSecs}s`,
      `{{inSuccess}} Session(s) were successfully pulled and {{inError}} failed to be pulled in ${executionDurationSecs}s`,
      'No Sessions have been pulled'
    );
    return result;
  }

  public async pullCdrs(): Promise<OCPIResult> {
    // Result
    const result: OCPIResult = {
      success: 0,
      failure: 0,
      total: 0,
      logs: []
    };
    // Perfs trace
    const startTime = new Date().getTime();
    // Get cdrs endpoint url
    let cdrsUrl = this.getEndpointUrl('cdrs', ServerAction.OCPI_PULL_CDRS);
    const momentFrom = moment().utc().subtract(2, 'days').startOf('day');
    cdrsUrl = `${cdrsUrl}?date_from=${momentFrom.format()}&limit=10`;
    let nextResult = true;
    do {
      // Call IOP
      const response = await this.axiosInstance.get(
        cdrsUrl,
        {
          headers: {
            Authorization: `Token ${this.ocpiEndpoint.token}`
          },
        });
      const cdrs = response.data.data as OCPICdr[];
      if (!Utils.isEmptyArray(cdrs)) {
        await Promise.map(cdrs, async (cdr: OCPICdr) => {
          try {
            await OCPIUtilsService.processCdr(this.tenant, cdr);
            result.success++;
          } catch (error) {
            result.failure++;
            result.logs.push(
              `Failed to update CDR ID '${cdr.id}': ${error.message}`
            );
          }
        },
        { concurrency: Constants.OCPI_MAX_PARALLEL_REQUESTS });
      }
      const nextUrl = OCPIUtils.getNextUrl(response.headers.link);
      if (nextUrl && nextUrl.length > 0 && nextUrl !== cdrsUrl) {
        cdrsUrl = nextUrl;
      } else {
        nextResult = false;
      }
    } while (nextResult);
    result.total = result.failure + result.success;
    const executionDurationSecs = (new Date().getTime() - startTime) / 1000;
    await Logging.logOcpiResult(this.tenant.id, ServerAction.OCPI_PULL_CDRS,
      MODULE_NAME, 'pullCdrs', result,
      `{{inSuccess}} CDR(s) were successfully pulled in ${executionDurationSecs}s`,
      `{{inError}} CDR(s) failed to be pulled in ${executionDurationSecs}s`,
      `{{inSuccess}} CDR(s) were successfully pulled and {{inError}} failed to be pulled in ${executionDurationSecs}s`,
      'No CDRs have been pulled'
    );
    return result;
  }

  public async processLocation(location: OCPILocation, company: Company, existingSites: Site[]): Promise<void> {
    // Handle Site
    let site: Site;
    const siteName = location.operator?.name ?? OCPIUtils.buildOperatorName(this.ocpiEndpoint.countryCode, this.ocpiEndpoint.partyId);
    site = existingSites.find((existingSite) => existingSite.name === siteName);
    if (!site) {
      // Create Site
      site = {
        name: siteName,
        createdOn: new Date(),
        companyID: company.id,
        issuer: false,
        address: {
          address1: location.address,
          postalCode: location.postal_code,
          city: location.city,
          country: location.country,
          coordinates: []
        }
      } as Site;
      if (location.coordinates?.latitude && location.coordinates?.longitude) {
        site.address.coordinates = [
          Utils.convertToFloat(location.coordinates.longitude),
          Utils.convertToFloat(location.coordinates.latitude)
        ];
      }
      site.id = await SiteStorage.saveSite(this.tenant, site, false);
      // Push the Site then it can be retrieve in the next round
      existingSites.push(site);
    }
    const locationName = site.name + Constants.OCPI_SEPARATOR + location.id;
    // Handle Site Area
    const siteAreas = await SiteAreaStorage.getSiteAreas(this.tenant.id,
      { siteIDs: [site.id], name: locationName, issuer: false, withSite: true },
      Constants.DB_PARAMS_SINGLE_RECORD);
    let siteArea = !Utils.isEmptyArray(siteAreas.result) ? siteAreas.result[0] : null;
    if (!siteArea) {
      // Create Site Area
      siteArea = {
        name: locationName,
        createdOn: new Date(),
        siteID: site.id,
        issuer: false,
        address: {
          address1: location.address,
          address2: location.name,
          postalCode: location.postal_code,
          city: location.city,
          country: location.country,
          coordinates: []
        }
      } as SiteArea;
      if (location.coordinates?.latitude && location.coordinates?.longitude) {
        siteArea.address.coordinates = [
          Utils.convertToFloat(location.coordinates.longitude),
          Utils.convertToFloat(location.coordinates.latitude)
        ];
      }
      siteArea.id = await SiteAreaStorage.saveSiteArea(this.tenant.id, siteArea, false);
    }
    if (!Utils.isEmptyArray(location.evses)) {
      for (const evse of location.evses) {
        if (!evse.uid) {
          throw new BackendError({
            action: ServerAction.OCPI_PULL_LOCATIONS,
            message: `Missing Charging Station EVSE UID in Location '${location.name}' with ID '${location.id}'`,
            module: MODULE_NAME, method: 'processLocation',
            detailedMessages:  { evse, location }
          });
        }
        if (evse.status === OCPIEvseStatus.REMOVED) {
          // Get existing charging station
          const currentChargingStation = await ChargingStationStorage.getChargingStationByOcpiLocationUid(
            this.tenant.id, location.id, evse.uid, ['id']
          );
          if (currentChargingStation) {
            await ChargingStationStorage.deleteChargingStation(this.tenant.id, currentChargingStation.id);
            await Logging.logDebug({
              tenantID: this.tenant.id,
              action: ServerAction.OCPI_PULL_LOCATIONS,
              message: `Removed Charging Station EVSE UID '${evse.uid}' in Location '${location.name}' with ID '${location.id}'`,
              module: MODULE_NAME, method: 'processLocation',
              detailedMessages: { evse, location }
            });
          }
          continue;
        }
        // Update Charging Station
        const chargingStation = OCPIUtilsService.convertEvseToChargingStation(evse, location);
        chargingStation.companyID = siteArea.site?.companyID;
        chargingStation.siteID = siteArea.siteID;
        chargingStation.siteAreaID = siteArea.id;
        await ChargingStationStorage.saveChargingStation(this.tenant.id, chargingStation);
        await ChargingStationStorage.saveChargingStationOcpiData(this.tenant.id, chargingStation.id, chargingStation.ocpiData);
        await Logging.logDebug({
          tenantID: this.tenant.id,
          action: ServerAction.OCPI_PULL_LOCATIONS,
          message: `Updated Charging Station ID '${evse.evse_id}' in Location '${location.name}'`,
          module: MODULE_NAME, method: 'processLocation',
          detailedMessages: location
        });
      }
    }
  }

  public async pushToken(token: OCPIToken): Promise<boolean> {
    // Get tokens endpoint url
    const tokensUrl = this.getEndpointUrl('tokens', ServerAction.OCPI_PUSH_TOKENS);
    // Read configuration to retrieve
    const countryCode = this.getLocalCountryCode(ServerAction.OCPI_PUSH_TOKENS);
    const partyID = this.getLocalPartyID(ServerAction.OCPI_PUSH_TOKENS);
    // Build url to IOP
    const fullUrl = tokensUrl + `/${countryCode}/${partyID}/${token.uid}`;
    // Call IOP
    await this.axiosInstance.put(
      fullUrl,
      token,
      {
        headers: {
          Authorization: `Token ${this.ocpiEndpoint.token}`,
          'Content-Type': 'application/json'
        },
      });
    return true;
  }

  public async remoteStartSession(chargingStation: ChargingStation, connectorID: number, tagID: string): Promise<OCPICommandResponse> {
    // Get command endpoint url
    const commandUrl = this.getEndpointUrl('commands', ServerAction.OCPI_START_SESSION) + '/' + OCPICommandType.START_SESSION;
    const callbackUrl = this.getLocalEndpointUrl('commands') + '/' + OCPICommandType.START_SESSION;
    const tag = await TagStorage.getTag(this.tenant.id, tagID, { withUser: true });
    if (!tag || !tag.issuer || !tag.active) {
      throw new BackendError({
        action: ServerAction.OCPI_START_SESSION,
        source: chargingStation.id,
        message: `${Utils.buildConnectorInfo(connectorID)} OCPI Remote Start Session is not available for Tag ID '${tagID}'`,
        module: MODULE_NAME, method: 'remoteStartSession',
        detailedMessages: { tag: tag }
      });
    }
    if (!tag.user || !tag.user.issuer) {
      throw new BackendError({
        action: ServerAction.OCPI_START_SESSION,
        source: chargingStation.id,
        message: `${Utils.buildConnectorInfo(connectorID)} OCPI Remote Start Session is not available for user with Tag ID '${tagID}'`,
        module: MODULE_NAME, method: 'remoteStartSession',
        detailedMessages: { user: tag.user }
      });
    }
    const token: OCPIToken = {
      uid: tag.id,
      type: OCPIUtils.getOCPITokenTypeFromID(tag.id),
      auth_id: tag.user.id,
      visual_number: tag.visualID,
      issuer: this.tenant.name,
      valid: true,
      whitelist: OCPITokenWhitelist.ALLOWED_OFFLINE,
      last_updated: new Date()
    };
    const authorizationId = Utils.generateUUID();
    // Get the location ID from the Site Area name
    const locationID = OCPIUtils.getOCPIEmspLocationIDFromSiteAreaName(chargingStation.siteArea.name);
    const remoteStart: OCPIStartSession = {
      response_url: callbackUrl + '/' + authorizationId,
      token: token,
      evse_uid: chargingStation.id,
      location_id: locationID,
      authorization_id: authorizationId
    };
    // Call IOP
    const response = await this.axiosInstance.post(
      commandUrl,
      remoteStart,
      {
        headers: {
          'Authorization': `Token ${this.ocpiEndpoint.token}`,
          'Content-Type': 'application/json'
        },
      });
    await Logging.logDebug({
      tenantID: this.tenant.id,
      action: ServerAction.OCPI_START_SESSION,
      source: chargingStation.id,
      message: `${Utils.buildConnectorInfo(connectorID)} OCPI Remote Start session response status '${response.status}'`,
      module: MODULE_NAME, method: 'remoteStartSession',
      detailedMessages: { remoteStart, response: response.data }
    });
    return response.data.data as OCPICommandResponse;
  }

  public async remoteStopSession(transactionId: number): Promise<OCPICommandResponse> {
    // Get command endpoint url
    const commandUrl = this.getEndpointUrl('commands', ServerAction.OCPI_START_SESSION) + '/' + OCPICommandType.STOP_SESSION;
    const callbackUrl = this.getLocalEndpointUrl('commands') + '/' + OCPICommandType.STOP_SESSION;
    // Get transaction
    const transaction = await TransactionStorage.getTransaction(this.tenant.id, transactionId);
    if (!transaction) {
      throw new BackendError({
        action: ServerAction.OCPI_START_SESSION,
        source: transaction?.chargeBoxID,
        message: `Transaction ID '${transactionId}' does not exist`,
        module: MODULE_NAME, method: 'remoteStopSession',
        detailedMessages: { transaction }
      });
    }
    if (!transaction.issuer) {
      throw new BackendError({
        action: ServerAction.OCPI_START_SESSION,
        source: transaction?.chargeBoxID,
        message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} Transaction belongs to an external organization`,
        module: MODULE_NAME, method: 'remoteStopSession',
        detailedMessages: { transaction }
      });
    }
    if (!transaction.ocpiData?.session) {
      throw new BackendError({
        action: ServerAction.OCPI_START_SESSION,
        source: transaction?.chargeBoxID,
        message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} No OCPI Session data`,
        module: MODULE_NAME, method: 'remoteStopSession',
        detailedMessages: { transaction }
      });
    }
    const payload: OCPIStopSession = {
      response_url: callbackUrl + '/' + transaction.ocpiData.session.id,
      session_id: transaction.ocpiData.session.id
    };
    // Call IOP
    const response = await this.axiosInstance.post(
      commandUrl,
      payload,
      {
        headers: {
          'Authorization': `Token ${this.ocpiEndpoint.token}`,
          'Content-Type': 'application/json'
        },
      });
    await Logging.logDebug({
      tenantID: this.tenant.id,
      action: ServerAction.OCPI_STOP_SESSION,
      source: transaction.chargeBoxID,
      message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} OCPI Remote Stop response status '${response.status}'`,
      module: MODULE_NAME, method: 'remoteStopSession',
      detailedMessages: { response: response.data }
    });
    return response.data.data as OCPICommandResponse;
  }
}
