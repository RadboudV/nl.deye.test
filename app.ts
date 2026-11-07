'use strict';

import Homey from 'homey';

module.exports = class DeyeApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('DeyeApp has been initialized');
  }

}
