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
  // https://bugzilla.mozilla.org/show_bug.cgi?id=1325758
  // insertbefore="context-sep-open"
  
  browser.contextMenus.create({
      id: MENU.NOLIMIT,
      title: browser.i18n.getMessage("repagination_nolimit"),
      contexts: ["link"]
  }, onCreated);

  let limits = [5,10,25,50,100];

  for(let j in limits) {
    let i = limits[j];
    browser.contextMenus.create({
        id: MENU.LIMIT + "_" + i,
        title: browser.i18n.getMessage("repagination_limit_x",i),
        contexts: ["link"]
    }, onCreated);

  }
  
  if(prefs.slideshows) {
    browser.contextMenus.create({
        id: MENU.SLIDE,
        title: browser.i18n.getMessage("repagination_slide"),
        contexts: ["link"]
    }, onCreated);

    let slides = [0,1,2,4,5,10,15,30,60,120];

    for(let j in slides) {
      let i = slides[j];
      browser.contextMenus.create({
          id: MENU.SLIDE + "_" + i,
          parentId: MENU.SLIDE,
          title: ([0,1,60,120].indexOf(i) != -1) ? browser.i18n.getMessage("repagination_slide_" + i) : browser.i18n.getMessage("repagination_slide_x",i),
          contexts: ["link"]
      }, onCreated);
    }
  }

  updStop();
}

function updStop() {
  if(RUNNING.size > 0) {
    browser.contextMenus.create({
        id: MENU.STOP,
        title: browser.i18n.getMessage("repagination_stop"),
        contexts: ["all"]
    }, onCreated);
  } else {
    browser.contextMenus.remove(MENU.STOP);
  }
}

var defaultSettings = {
  slideshows: false,
  exists: true // special pref to restore defaults
};

function prefReset(newSettings, areaName) {
  console.log("prefs changed")
  if (areaName == "local" && ("exists" in newSettings)) {
    browser.contextMenus.removeAll();
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

  function repaginate(tab, num, slideshow) {
    console.info("repaginate: " + num + "/" + slideshow);
    try {
      PORTS[tab].postMessage({
        msg: "normal",
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

  function stop(tab) {
    console.info("stop");
    PORTS[tab].postMessage({
        msg: "stop"
    });
  }

  function process(info, tab) {
    var str = info.menuItemId;
    switch (str) {
      case MENU.NOLIMIT: repaginate(tab); break;
      case MENU.STOP: stop(tab); break;
    }
    
    if(str.startsWith(MENU.LIMIT)) {
      // https://stackoverflow.com/questions/5555518/split-variable-from-last-slash-jquery
      var last = str.substring(str.lastIndexOf("_") + 1, str.length);
      repaginate(tab, parseInt(last, 10), false);
    }
    if(str.startsWith(MENU.SLIDE)) {
      var last = str.substring(str.lastIndexOf("_") + 1, str.length);
      repaginate(tab, parseInt(last, 10), true);
    }
  }

  // We lazily inject the main content script in a vague hope for efficiency
  // We use ports for messaging but have to store the messages until the port is opened.

  browser.contextMenus.onClicked.addListener((info, tab) => {
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
