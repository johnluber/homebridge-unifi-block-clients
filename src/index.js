const Unifi = require('./unifi');

let Accessory, Service, Characteristic, UUIDGen;

module.exports = function(homebridge) {
  // Accessory must be created from PlatformAccessory Constructor
  Accessory = homebridge.platformAccessory;

  // Service and Characteristic are from hap-nodejs
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;
  
  // For platform plugin to be considered as dynamic platform plugin,
  // registerPlatform(pluginName, platformName, constructor, dynamic), dynamic must be true
  homebridge.registerPlatform("homebridge-unifi-block-clients", "unifiBlockClients", Platform, true);
}

class Platform {
  // Platform constructor
  // config may be null
  // api may be null if launched from old homebridge version
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;

    if(!config) {
      return false;
    }

    let requiredConfig = argName => {
      log.error(`${argName} is required. Check config.json.`)
      throw new Error();
    };
    
    let {
      username = requiredConfig('username'),
      password = requiredConfig('password'),
      controllerUrl = requiredConfig('controllerUrl'),
      pollingFrequency = 5000,
      siteName = "default",
      clients = []
    } = config;

    this.accessories = [];
    this.unifi = new Unifi({log, username, password, controllerUrl, pollingFrequency, siteName, clients});

    if (api) {
        // Listen to event "didFinishLaunching", this means homebridge already finished loading cached accessories.
        // Platform Plugin should only register new accessory that doesn't exist in homebridge after this event.
        // Or start discover new accessories.
        api.on('didFinishLaunching', () => {
          let auth = this.unifi.authenticate();
          let clientsToAdd = clients.filter(client => !this.accessories.map(a => a.context.mac).includes(client));
          let clientsToRemove = this.accessories.filter(client => !clients.includes(client.context.mac));

          clientsToRemove.length && clientsToRemove.forEach(this.removeAccessory);

          clientsToAdd.length && auth
            .then(() => this.unifi.getKnownClients())
            .then(response => {
              response.data.data
                .filter(client => clientsToAdd.includes(client.mac))
                .forEach(this.addAccessory);
            });

          auth.then(() => {
            this.auth = true;
            setInterval(() => this.accessories.forEach(this.getAccessoryValue), pollingFrequency)
          })
      });
    }
  }

  toggleAccessoryValue = (accessory, isOn) => {
    if(!this.config || !this.auth) {
      return false;
    }

    let action = isOn ? this.unifi.blockClient : this.unifi.unblockClient;
    return action(accessory.context.mac);
  }

  getAccessoryValue = (accessory) => {
    if(!this.config || !this.auth) {
      return false;
    }

    return this.unifi.getClientBlockStatus(accessory.context._id).then(isBlocked => {
      return accessory
        .getService(Service.Switch)
        .setCharacteristic(Characteristic.On, isBlocked);
    });
  }

  setUpAccessory = (accessory) => {
    if(!this.config || !this.auth) {
      return false;
    }

    if (accessory.getService(Service.Switch)) {
      accessory.getService(Service.Switch)
      .getCharacteristic(Characteristic.On)
      .on('get', callback => this.getAccessoryValue(accessory).then(() => callback()))
      .on('set', (value, callback) => this.toggleAccessoryValue(accessory, value).then(() => callback()));
    }
    this.accessories.push(accessory);
  }
  
  // Function invoked when homebridge tries to restore cached accessory.
  // Developer can configure accessory at here (like setup event handler).
  // Update current value.
  configureAccessory = (accessory) => {
    if(!this.config || !this.auth) {
      return false;
    }

    this.log(`Loaded client: ${accessory.context.mac} (${accessory.displayName})`);

    // Set the accessory to reachable if plugin can currently process the accessory,
    // otherwise set to false and update the reachability later by invoking 
    // accessory.updateReachability()
    accessory.reachable = true;

    this.setUpAccessory(accessory);
  }

  // Sample function to show how developer can add accessory dynamically from outside event
  addAccessory = (client) => {
    if(!this.config || !this.auth) {
      return false;
    }

    let uuid = UUIDGen.generate(client._id);
    let accessoryName = client.name || client.hostname || client._id;
    let newAccessory = new Accessory(accessoryName, uuid);
    
    this.log(`Added client from config: ${client.mac} (${newAccessory.displayName})`);
    
    // Plugin can save context on accessory to help restore accessory in configureAccessory()
    newAccessory.context = client;
    
    // Make sure you provided a name for service, otherwise it may not visible in some HomeKit apps
    newAccessory.addService(Service.Switch, `Block ${accessoryName}`)
    
    this.setUpAccessory(newAccessory);
    this.api.registerPlatformAccessories("homebridge-unifi-block-clients", "unifiBlockClients", [newAccessory]);
  }

  updateAccessoriesReachability = () => {
    if(!this.config || !this.auth) {
      return false;
    }

    this.log("Update Reachability");
    for (var index in this.accessories) {
      var accessory = this.accessories[index];
      accessory.updateReachability(false);
    }
  }
  
  removeAccessory = (accessory) => {
    if(!this.config || !this.auth) {
      return false;
    }

    this.log(`Removing accessory: ${accessory.context.mac} (${accessory.displayName})`); 
    this.api.unregisterPlatformAccessories("homebridge-unifi-block-clients", "unifiBlockClients", [accessory]);
  
    this.accessories = this.accessories.filter(a => a.context.mac !== accessory.context.mac);
  }
}
