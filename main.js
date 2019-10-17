/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const PORTS = {};
const PENDING = {};
const RUNNING = new Set();

function onError(error) {
  console.error(error);
}

const MENU = {
    NOLIMIT: 'REPAGINATION_NOLIMIT',
    LIMIT: 'REPAGINATION_LIMIT',
    SLIDE: 'REPAGINATION_SLIDE',
    STOP: 'REPAGINATION_STOP'
}

function onCreated(n) {
  if (browser.runtime.lastError) {
    console.error("Error creating menu item: %o", browser.runtime.lastError);
  }
}

function createMenu(prefs) {
  let c = ["link"]; // ContextTypes for most menu items

  browser.menus.create({
      id: MENU.NOLIMIT,
      title: browser.i18n.getMessage("repagination_nolimit"),
      contexts: c
  }, onCreated);

  let limits = [5,10,25,50,100];

  for(let j in limits) {
    let i = limits[j];
    browser.menus.create({
        id: MENU.LIMIT + "_" + i,
        title: browser.i18n.getMessage("repagination_limit_x",i),
        contexts: c
    }, onCreated);

  }

  if(prefs.slideshows) {
    browser.menus.create({
        id: MENU.SLIDE,
        title: browser.i18n.getMessage("repagination_slide"),
        contexts: c
    }, onCreated);

    let slides = [0,1,2,4,5,10,15,30,60,120];

    for(let j in slides) {
      let i = slides[j];
      browser.menus.create({
          id: MENU.SLIDE + "_" + i,
          parentId: MENU.SLIDE,
          title: ([0,1,60,120].indexOf(i) != -1) ? browser.i18n.getMessage("repagination_slide_" + i) : browser.i18n.getMessage("repagination_slide_x",i),
          contexts: c
      }, onCreated);
    }
  }

  updStop();
}

function updStop() {
  if(RUNNING.size > 0) {
    browser.menus.create({
        id: MENU.STOP,
        title: browser.i18n.getMessage("repagination_stop"),
        contexts: ["all"]
    }, onCreated);
  } else {
    browser.menus.remove(MENU.STOP);
  }
}

var defaultSettings = {
  slideshows: false,
  exists: true // special pref to restore defaults
};

function prefReset(newSettings, areaName) {
  console.log("prefs changed")
  if (areaName == "local" && ("exists" in newSettings)) {
    browser.menus.removeAll();
    console.log("recreating menu")
    browser.storage.local.get().then(initSettings, onError);
  }
}

function initSettings(prefs) {
  if (!("exists" in prefs) || !prefs.exists) {
    browser.storage.onChanged.removeListener(prefReset);
    browser.storage.local.set(defaultSettings);
    browser.storage.onChanged.addListener(prefReset);
    prefs = defaultSettings;
  }

  createMenu(prefs);
}

function myinit(prefs) {
  initSettings(prefs);

  function process(info, tab) {
    let str = info.menuItemId;

    if(str == MENU.STOP) {
      console.info("stop");
      PORTS[tab].postMessage({
          msg: "stop"
      });
      return;
    }

    let num, slideshow;
    if(str == MENU.NOLIMIT) {
      num = 0;
      slideshow = false;
    } else if(str.startsWith(MENU.LIMIT)) {
      // https://stackoverflow.com/questions/5555518/split-variable-from-last-slash-jquery
      num = parseInt(str.substring(str.lastIndexOf("_") + 1, str.length), 10);
      slideshow = false;
    } else if(str.startsWith(MENU.SLIDE)) {
      num = parseInt(str.substring(str.lastIndexOf("_") + 1, str.length), 10);
      slideshow = true;
    }

    console.info("repaginate: " + num + "/" + slideshow);
    try {
      PORTS[tab].postMessage({
        msg: "normal",
        target: info.targetElementId,
        num: num,
        slideshow: slideshow,
        allowScripts: prefs.allowScripts,
        yielding: prefs.yielding
      });
      RUNNING.add(tab);
      updStop();
    } catch (ex) {
      console.log(ex);
      console.error("failed to run repaginate");
    }
  }

  // We lazily inject the main content script in a vague hope for efficiency
  // We use ports for messaging but have to store the messages until the port is opened.

  browser.menus.onClicked.addListener((info, tab) => {
    console.log(info, tab);
    if(tab.id in PORTS) {
      process(info, tab.id);
    } else {
      console.log("injecting " + tab.id);
      browser.tabs.executeScript(tab.id, { file: "content-script.js" } );
      PENDING[tab.id] = info;
    }
  });


  browser.runtime.onConnect.addListener(function(port) {
    let tabid = port.sender.tab.id;
    PORTS[tabid] = port;
    port.onDisconnect.addListener((p) => {
      delete PORTS[tabid];
      delete PENDING[tabid];
      RUNNING.delete(tabid);
      updStop();
    });
    port.onMessage.addListener(msg => {
      switch (msg.msg) {
        case "unregister":
          RUNNING.delete(tabid);
          updStop();
          break;
      }
    });

    if (port.sender.tab.id in PENDING) {
      var info = PENDING[port.sender.tab.id];
      delete PENDING[port.sender.tab.id];
      process(info, port.sender.tab.id);
    }
  });
}

browser.storage.local.get().then(myinit, onError);

browser.storage.onChanged.addListener(prefReset);

console.info("all good!");

/* vim: set et ts=2 sw=2 : */
