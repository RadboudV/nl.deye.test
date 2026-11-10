import * as Modbus from 'jsmodbus';
import net from 'net';

import { EventEmitter } from 'events';

import { Deye } from '../../lib/deye';
import {
  readAllRegisters, readIdentity, findRegisterSet, formatProtocol, protocolHex,
  RegisterSet, Snapshot, SnapshotSource,
} from '../../lib/registers';
import { ControlError, RegisterIO } from '../../lib/controls';

import Homey from 'homey';

// Default polling interval in seconds
const DEFAULT_POLLING_INTERVAL = 30;
// After a write, ignore register values from polls for this long (the inverter needs time to apply the change)
const WRITE_SETTLE_MS = 5000;
// Mark the device unavailable after this many failed polls/writes in a row
const UNAVAILABLE_AFTER_FAILURES = 3;
// Give up connecting to an unreachable inverter after this long (otherwise the OS can take minutes)
const CONNECT_TIMEOUT_MS = 10000;
// How long a flow card waits for a running poll/write before giving up
const CONTROL_WAIT_MS = 30000;

//module.exports = class DeyeDevice extends Homey.Device {
class MyDeyeDevice extends Deye implements SnapshotSource {
	datatimer!: NodeJS.Timer;

  // ---- shared data for the battery device ----------------------------------
  // This device is the only one that talks Modbus. After every poll the full
  // register snapshot is published on `bus` ('snapshot'); availability changes
  // are published as 'availability'. The battery device listens to both.
  readonly bus = new EventEmitter();
  private snapshot: Snapshot = {};
  private unsupported = new Set<string>();   // registers this inverter rejects; skipped on later polls

  // The register map depends on the inverter's communication protocol version (register 2).
  // It is read on every poll; null = not known yet or not supported.
  private registerSet: RegisterSet | null = null;
  private unsupportedReason: string | null = null;

  getSnapshot(): Snapshot { return this.snapshot; }
  
  
  private socket: net.Socket | null = null;
  private client: InstanceType<typeof Modbus.client.TCP> | null = null;
  private connecting: Promise<void> | null = null;
  private busy = false;            // one Modbus transaction sequence at a time (poll OR write)
  private failures = 0;
  private lastWrite = 0;           // timestamp (ms) of the last successful write to the Deye
  private available: boolean | null = null;   // last availability state reported to Homey (null = not reported yet)

  // ---- availability --------------------------------------------------------

  // Call after every successful poll/write. Only talks to Homey when the state changes.
  private markSuccess() {
    this.failures = 0;
    if (this.available !== true) {
      this.available = true;
      this.setAvailable().catch(this.error);
	  this.bus.emit('availability', true);
      this.log('Deye Inverter reachable, device set available');
    }
  }

  // Call after every failed poll/write. Marks the device unavailable after UNAVAILABLE_AFTER_FAILURES in a row.
  private markFailure(reason: string) {
    this.failures++;
    if (this.failures >= UNAVAILABLE_AFTER_FAILURES && this.available !== false) {
      this.available = false;
      this.setUnavailable(`Deye Inverter not reachable (${reason})`).catch(this.error);
	  this.bus.emit('availability', false);
      this.log('Deye Inverter not reachable, device set unavailable:', reason);
    }
  }


  // ---- communication protocol ----------------------------------------------

  private setSettingIfChanged(key: string, value: string) {
    if (this.getSetting(key) !== value) this.setSettings({ [key]: value }).catch(this.error);
  }

  /**
   * Read the communication protocol version (register 2) and pick the matching
   * register set. An unknown version makes the device unavailable (and with that
   * blocks all flow card writes); polling continues, so the device recovers by
   * itself when the inverter reports a known version again.
   */
  private async detectProtocol(client: InstanceType<typeof Modbus.client.TCP>): Promise<RegisterSet | null> {
    const { protocol, serial } = await readIdentity(client);
    const set = findRegisterSet(protocol);
    const label = `${formatProtocol(protocol)} (${protocolHex(protocol)})`;

    if (set !== this.registerSet) {
      this.log(set ? `Communication protocol ${label}: using register set ${set.name}` : `Communication protocol ${label} is not supported`);
      this.registerSet = set;
      this.unsupported.clear();
    }
    this.setSettingIfChanged('protocolversion', set ? label : `${label} - not supported`);
    if (serial) this.setSettingIfChanged('serial', serial);

    if (!set) {
      this.unsupportedReason = `Unsupported communication protocol ${label}`;
      this.failures = 0;
      if (this.available !== false) {
        this.available = false;
        this.setUnavailable(this.unsupportedReason).catch(this.error);
        this.bus.emit('availability', false);
      }
      return null;
    }
    this.unsupportedReason = null;
    return set;
  }

  // ---- connection handling -------------------------------------------------

  private isConnected(): boolean {
    return !!this.socket && !this.socket.destroyed && !this.socket.connecting
      && this.socket.readyState === 'open';
  }
 
  private connect(): Promise<void> {
    if (this.isConnected()) return Promise.resolve();
    if (this.connecting) return this.connecting;          // someone is already connecting
 
    this.connecting = new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      const client = new Modbus.client.TCP(socket, Number(this.getSetting('id')), 5000);
 
      const onFail = (err: Error) => { this.dropConnection(); reject(err); };
 
      socket.setKeepAlive(true, 10_000);   // detect half-dead links
      socket.setNoDelay(true);
      socket.once('error', onFail);
      socket.setTimeout(CONNECT_TIMEOUT_MS);
      socket.once('timeout', () => onFail(new Error('connect timeout')));
      socket.on('close', () => { this.socket = null; this.client = null; });
      socket.on('error', (err) => this.error('socket error', err.message)); // never leave unhandled
 
      socket.connect({ host: this.getSetting('address'), port: Number(this.getSetting('port')) }, () => {
        socket.removeListener('error', onFail);
        socket.removeAllListeners('timeout');
        socket.setTimeout(0);              // connected: request timeouts are handled by jsmodbus
        this.socket = socket;
        this.client = client;
        resolve();
      });
    }).finally(() => { this.connecting = null; });
 
    return this.connecting;
  }
 
  private dropConnection() {
    if (this.socket) { this.socket.removeAllListeners('close'); this.socket.destroy(); }
    this.socket = null;
    this.client = null;
  }
 
// Debug logging helper
private debug(...args: any[]): void {
    if (this.getSetting('debug_logging')) {
        this.log('[DEBUG]', ...args);
    }
}


  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
	this.debug('Deye device has been initialized');
	// await this.setClass('sensor').catch(this.error)
    //this.log('Deye device has been initialized');
 
    let name = this.getData().id;
    //this.log("Device name id " + name );
    //this.log("Device name " + this.getName());
    this.debug("Device name id " + name );
    this.debug("Device name " + this.getName());


	let settings = this.getSettings();

    if (settings.pollinginterval === undefined) {
      this.setSettings({ pollinginterval: DEFAULT_POLLING_INTERVAL });
      settings.pollinginterval = DEFAULT_POLLING_INTERVAL;
	}

    this.datatimer = this.homey.setInterval(() => {
      // poll device state from Deye Inverter
      this.pollDeyeInverter('datavalues');
    }, settings.pollinginterval * 1000);

    this.pollDeyeInverter('initial');
	
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    //this.log('Deye Hybrid Inverter device has been added');
	this.debug('Deye Hybrid Inverter device has been added');
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({
    oldSettings,
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: boolean | string | number | undefined | null };
    newSettings: { [key: string]: boolean | string | number | undefined | null };
    changedKeys: string[];
  }): Promise<string | void> {
  
    //this.log("Deye settings where changed");
	this.debug("Deye settings where changed");

//Time of Use
    if (changedKeys.includes('settings_timeofuseenabled')) {
	  // this.log('Deye settings "settings_timeofuseenabled" were changed. Changed settings from', oldSettings.settings_timeofuseenabled, 'to', newSettings.settings_timeofuseenabled);
	  this.debug('Deye settings "settings_timeofuseenabled" were changed. Changed settings from', oldSettings.settings_timeofuseenabled, 'to', newSettings.settings_timeofuseenabled);
    }

//solarsellenabled
    if (changedKeys.includes('settings_solarsellenabled')) {
	  //this.log('Deye settings "settings_solarsellenabled" were changed. Changed settings from', oldSettings.settings_solarsellenabled, 'to', newSettings.settings_solarsellenabled);
	  this.debug('Deye settings "settings_solarsellenabled" were changed. Changed settings from', oldSettings.settings_solarsellenabled, 'to', newSettings.settings_solarsellenabled);
    }

//Asymetric Phase Feeding
    if (changedKeys.includes('settings_asymetricphasefeeding')) {
	  this.log('Deye settings "settings_asymetricphasefeeding" were changed. Changed settings from', oldSettings.settings_asymetricphasefeeding, 'to', newSettings.settings_asymetricphasefeeding);
	  this.updateDeyev2('asymetricphasefeeding', Number(newSettings.settings_asymetricphasefeeding), this);
    }

//Polling Interval has changed, clear current timer and set and start new timer
    if (changedKeys.indexOf('pollinginterval') > -1) {
      this.log('Changing the "pollinginterval" settings from', oldSettings.pollinginterval, 'to', newSettings.pollinginterval);

      this.homey.clearInterval(this.datatimer);
	  //this.homey.clearInterval(this.settingstimer);
      this.datatimer = this.homey.setInterval(() => {
        // poll device state from the Deye inverter
        this.pollDeyeInverter('datavalues');
      }, Number(newSettings.pollinginterval) * 1000);
    }

// Connection settings changed: the persistent socket still points at the old host/port/unit id.
// Drop it and poll again so the device becomes (un)available based on the new settings.
    if (['address', 'port', 'id'].some((k) => changedKeys.includes(k))) {
	  this.log('Connection settings changed, reconnecting');
	  this.dropConnection();
	  this.failures = 0;
	  this.available = null;
	  this.registerSet = null;
	  this.unsupported.clear();
	  // onSettings runs before the new values are stored, so poll a moment later
	  this.homey.setTimeout(() => this.pollDeyeInverter('datavalues'), 1000);
    }
	
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
 async onRenamed(name: string) {
    this.log('Deye device was renamed');
  }

//********************************************************
  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log('Deye device has been deleted');
	this.bus.emit('availability', false);
	this.bus.removeAllListeners();
	this.homey.clearInterval(this.datatimer);
	this.dropConnection();
	// this.homey.clearInterval(this.settingstimer);
  }
//********************************************************


//********************************************************
  /**
   * onUninit.
   */
  async onUninit() {
    this.log('Deye Inverter device has been Un initialized.');
    await this.saveOwnUsage();
    this.homey.clearInterval(this.datatimer);
	this.dropConnection();
  }
//********************************************************

//********************************************************
  /**
   * Poll the inverter
   */
  async pollDeyeInverter(datatofetch: string) {
 
 	this.log("pollDeyeInverter", datatofetch);
	if (this.busy) return;                 // previous poll/write still running -> skip
	this.busy = true;

   try {
      await this.connect();                // no-op when already connected
      const client = this.client!;

      // 1) which register map does this inverter use?  (unsupported version: device is set unavailable)
      const set = await this.detectProtocol(client);
      if (!set) return;

      this.debug('pollDeyeInverter: fetching', datatofetch);

      // One snapshot with ALL registers, read in a few block requests. Timeouts and connection
      // errors are thrown and handled below; registers the inverter rejects are skipped.
      const finalRes = await readAllRegisters(client, set, this.unsupported);
      // If nothing could be read, treat it as a dead link:
      if (Object.keys(finalRes).length === 0) throw new Error('no registers could be read');
 
      this.markSuccess();
      if (this.getSetting('modbusstatus') !== 'Connected') {
        this.setSettings({ modbusstatus: 'Connected' }).catch(this.error);   // only write when the value changes
      }
      // Right after a write the inverter may still report the old value -> skip processing to avoid "jumping" values
      if (Date.now() - this.lastWrite >= WRITE_SETTLE_MS) {
        this.snapshot = finalRes;
        await this.processDeyeResult(finalRes);        // inverter groups only
        this.bus.emit('snapshot', finalRes);           // battery device picks up its part
      } else {
        this.log('pollDeyeInverter: skipping processDeyeResult, write settling');
      }
    } catch (err) {
      this.error('poll failed', (err as Error).message);
      this.dropConnection();               // next poll reconnects from scratch
      this.resetTriggerState();            // grid state is unknown while the inverter cannot be read
      if (this.getSetting('modbusstatus') !== 'Error') {
        this.setSettings({ modbusstatus: 'Error' }).catch(this.error);
      }
      this.markFailure((err as Error).message);
    } finally {
      this.busy = false;
    }
} 
 
 
 


//*****************************************************************************************************
// Update Deye settings
//*****************************************************************************************************

async updateDeyev2(type: string, value: number, device: Homey.Device) {
	this.log("updateDeyev2");
    const set = this.registerSet;
    const def = set?.registers.asymetricphasefeeding;
    if (!set || !set.writesVerified || !def) {
      this.error('write skipped: no verified register map for this inverter yet', type);
      return;
    }
    // wait for a running poll to finish instead of clearing/restarting the timer
    while (this.busy) await new Promise(r => this.homey.setTimeout(r, 100));
    this.busy = true;
    try {
      await this.connect();
      const c = this.client!;
      switch (type) {
//        case 'settemperature':      await c.writeSingleRegister(2, value); break;
//        case 'settemperatureshift': await c.writeSingleRegister(4, value); break;
//        case 'setthermostatmode':   await c.writeSingleRegister(0, value); break;
//        case 'setsilentmode':       await c.writeSingleCoil(2, Boolean(value)); break;
//        case 'setonoff':            await c.writeSingleCoil(0, Boolean(value)); break;
		case 'asymetricphasefeeding': await c.writeMultipleRegisters(def.address, [value]); break;
      }
      this.lastWrite = Date.now();
      this.markSuccess();                  // a successful write proves the deye inverter is reachable
    } catch (err) {
      // Not counted as an availability failure: a Modbus exception (e.g. rejected value) is not a connection
      // problem. The poll loop decides when the device is unavailable.
      this.error('write failed', type, (err as Error).message);
      this.dropConnection();
    } finally {
      this.busy = false;
    }
  }

//*****************************************************************************************************
// Control: run flow card actions (writes) on the inverter
//*****************************************************************************************************

  /**
   * Run `action` with exclusive use of the Modbus connection (no poll or other
   * write runs meanwhile). Validation problems and refused writes are thrown as
   * errors with a readable message, so the flow shows why a card failed.
   */
  async control<T>(what: string, action: (io: RegisterIO) => Promise<T>): Promise<T> {
    if (this.available === false) throw new Error(this.unsupportedReason ?? 'The Deye inverter is not reachable right now');

    const deadline = Date.now() + CONTROL_WAIT_MS;
    while (this.busy) {
      if (Date.now() > deadline) throw new Error('The inverter connection is busy, try again');
      await new Promise<void>((r) => this.homey.setTimeout(r, 100));
    }
    this.busy = true;
    let started = false;
    try {
      await this.connect();
      const c = this.client!;
      // Writes only run on a protocol version whose register map and bit layouts are verified
      const set = this.registerSet ?? await this.detectProtocol(c);
      if (!set) throw new ControlError(this.unsupportedReason ?? 'Unsupported communication protocol');
      if (!set.writesVerified) throw new ControlError(`Writing is not verified for communication protocol ${set.name}`);
      const io: RegisterIO = {
        set,
        read: async (address, length) =>
          (await c.readHoldingRegisters(address, length)).response.body.valuesAsArray as number[],
        // Always "write multiple registers" (function code 16), also for a single value:
        // this inverter / logger does not answer "write single register" (function code 6),
        // which showed up as "Req timed out" on every flow card.
        write: async (address, values) => { await c.writeMultipleRegisters(address, values); },
        pause: (ms) => new Promise<void>((r) => this.homey.setTimeout(r, ms)),
      };
      started = true;
      const result = await action(io);
      this.markSuccess();
      // refresh the values shortly after the inverter has applied the change
      this.homey.setTimeout(() => this.pollDeyeInverter('datavalues'), WRITE_SETTLE_MS + 500);
      return result;
    } catch (err) {
      if (err instanceof ControlError) throw err;          // bad input or refused write: connection is fine
      const e = err as any;
      const message = e?.message ?? e?.err ?? String(err);
      this.error(`${what} failed`, message);
      this.dropConnection();
      throw new Error(`${what} failed: ${message}`);
    } finally {
      if (started) this.lastWrite = Date.now();
      this.busy = false;
    }
  }

//*****************************************************************************************************


//******************************************************************************************************************

}
module.exports = MyDeyeDevice;