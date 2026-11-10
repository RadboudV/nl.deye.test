class Device {
  constructor(){ this.settings={}; this.caps={}; this.availability=null; this.unavailableMessage=null; this.error=()=>{}; this.log=()=>{};
    this.homey={ clock:{getTimezone:()=>'Europe/Amsterdam'}, flow:{getDeviceTriggerCard:()=>({trigger:async()=>{}})}, setTimeout:(f,ms)=>setTimeout(f,ms), setInterval:(f,ms)=>setInterval(f,ms), clearInterval:clearInterval }; }
  getSetting(k){return this.settings[k]} getStoreValue(k){return (this.store||{})[k]} async setStoreValue(k,v){this.store=this.store||{};this.store[k]=JSON.parse(JSON.stringify(v))} getCapabilityValue(c){return this.caps[c]} getSettings(){return this.settings}
  async setSettings(s){Object.assign(this.settings,s)}
  async setAvailable(){this.availability=true;this.unavailableMessage=null} async setUnavailable(m){this.availability=false;this.unavailableMessage=m}
  getAvailable(){return this.availability!==false}
  hasCapability(c){return c in this.caps} async addCapability(c){this.caps[c]=null} async removeCapability(c){delete this.caps[c]}
  async setCapabilityValue(c,v){this.caps[c]=v} async setCapabilityOptions(){}
  getData(){return {id:'t'}} getName(){return 't'}
}
class Driver { log(){} error(){} getDevices(){return []} }
module.exports = { default:{Device,Driver}, Device, Driver };
