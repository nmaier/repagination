/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const EXPORTED_SYMBOLS = [
  "Cc", "Ci", "Cu", "ctor", "weak", "reportError",
  "Services", "Interfaces", "XPCOMUtils",
  "BASE_PATH",
  "require", "unload",
  "_setupLoader"
  ];

const {
  classes: Cc,
  interfaces: Ci,
  utils: Cu,
  Constructor: ctor
} = Components;
const {
  getWeakReference: weak,
  reportError: reportError
} = Cu;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/AddonManager.jsm");

Services = Object.create(Services);
const Instances = {};
function itor(name, cls, iface, init) {
  if (init) {
    XPCOMUtils.defineLazyGetter(Instances, name, function() ctor(cls, iface, init));
    XPCOMUtils.defineLazyGetter(Instances, "Plain" + name, function() ctor(cls, iface));
  }
  else {
    XPCOMUtils.defineLazyGetter(Instances, name, function() ctor(cls, iface));
    XPCOMUtils.defineLazyGetter(Instances, name.toLowerCase(), function() new this[name]());
  }
}

itor("XHR", "@mozilla.org/xmlextras/xmlhttprequest;1", "nsIXMLHttpRequest");
itor("ScriptError", "@mozilla.org/scripterror;1", "nsIScriptError", "init");

const {SELF_PATH, BASE_PATH} = (function() {
  let rv;
  try { throw new Error("narf"); }
  catch (ex) {
    rv = {
      SELF_PATH: ex.fileName,
      BASE_PATH: /^(.+\/).*?$/.exec(ex.fileName)[1]
    };
  }
  return rv;
})();

const global = this;

// logging stubs
var log = function() {} // stub
var LOG_DEBUG = 0, LOG_INFO = 0, LOG_ERROR = 0;

var _unloaders = [];
function _runUnloader(fn, args) {
    try {
      fn.apply(null, args);
    }
    catch (ex) {
      log(LOG_ERROR, "unloader failed", ex);
    }
}
function unload(fn) {
  if (fn == "shutdown") {
    let _unloaders = global._unloaders;

    log(LOG_INFO, "shutdown");
    for (let i = _unloaders.length; ~(--i);) {
      _runUnloader(_unloaders[i]);
    }
    _unloaders.splice(0);
    return;
  }

  // add an unloader
  if (typeof(fn) != "function") {
    throw new Error("unloader is not a function");
  }
  _unloaders.push(fn);
  return function() {
    _runUnloader(fn, arguments);
    _unloaders = _unloaders.filter(function(c) c != fn);
  };
} 

const _registry = Object.create(null);
function require(module) {
  module = BASE_PATH + module + ".js";
 
  // already loaded?
  if (module in _registry) {
    return _registry[module];
  }

  // try to load the module
  log(LOG_DEBUG, "going to load: " + module);
  let scope = {};
  for (let i = EXPORTED_SYMBOLS.length; ~(--i);) {
    let sym = EXPORTED_SYMBOLS[i];
    if (sym[0] == "_") {
      continue;
    }
    scope[sym] = global[sym];
  }
  scope.exports = Object.create(null);
  try {
    Services.scriptloader.loadSubScript(module, scope);
  }
  catch (ex) {
    log(LOG_ERROR, "failed to load " + module, ex);
    throw ex;
  }

  _registry[module] = scope.exports;
  log(LOG_DEBUG, "loaded module: " + module);

  return scope.exports;
} 

unload(function() {
  let keys = Object.keys(_registry);
  for (let i = keys.length; ~(--i);) {
    delete _registry[keys[i]];
  }
  // unload ourselves
  Cu.unload(SELF_PATH);
});


function _setupLoader(data, callback) AddonManager.getAddonByID(data.id, function loader_startup(addon) {
  try {
    let logging = global.logging = require("logging");
    for (let [k,v] in Iterator(logging)) {
      EXPORTED_SYMBOLS.push(k);
      global[k] = v;
    }
    logging.setLogPrefix(addon.name);

    let prefs = require("preferences");
    prefs.init(addon.id);
    EXPORTED_SYMBOLS.push("prefs");
    EXPORTED_SYMBOLS.push("globalPrefs");
    global.prefs = prefs.prefs;
    global.globalPrefs = prefs.globalPrefs;

    try {
      prefs.prefs.observe("loglevel", function(p,v) logging.setLogLevel(v));
    }
    catch (ex) {
      log(LOG_ERROR, "failed to set log level", ex);
    }
    // XXX change listener
  }
  catch (ex) {
    // probably do not have a working log() yet
    reportError(ex);
    return;
  }

  try {
    if (callback) {
      log(LOG_DEBUG, "loader: running callback");
      callback();
    }
  }
  catch (ex) {
    log(LOG_ERROR, "callback failed!", ex);
  }
  log(LOG_DEBUG, "loader: done");
});

/* vim: set et ts=2 sw=2 : */
