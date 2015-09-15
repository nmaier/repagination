/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const {registerOverlay, unloadWindow} = require("sdk/windows");

/* globals _ */
lazy(this, "_", function() {
  let bundle = require("sdk/strings").
    getBundle("chrome://repagination/locale/repagination.properties");
  return function() {
    return bundle.getString.apply(bundle, arguments);
  };
});

function checkSameOrigin(node, tryLoadUri) {
  try {
    if (!(tryLoadUri instanceof Ci.nsIURI)) {
      tryLoadUri = Services.io.newURI(tryLoadUri, null, null);
    }
    if (tryLoadUri.schemeIs("data")) {
      return true;
    }
    let pr = node.nodePrincipal;
    pr = Cc["@mozilla.org/scriptsecuritymanager;1"].
      getService(Ci.nsIScriptSecurityManager).
      getAppCodebasePrincipal(pr.URI,
                              pr.appId,
                              pr.isInBrowserElement);
    if (pr.checkMayLoad.length == 3) {
      pr.checkMayLoad(tryLoadUri, false, false);
    }
    else {
      pr.checkMayLoad(tryLoadUri, false);
    }
    return true;
  }
  catch (ex) {
    log(LOG_DEBUG, "denied load of " + (tryLoadUri.spec || tryLoadUri), ex);
    return false;
  }
}

function main(window, document) {
  const $ = id => document.getElementById(id);
  const $$$ = q => document.querySelectorAll(q);

  function repaginate(num, slideshow) {
    log(LOG_INFO, "repaginate: " + num + "/" + slideshow);
    try {
      let mm = window.gBrowser.selectedBrowser.messageManager;
      mm.sendAsyncMessage("repagination:normal", {
        num: num,
        slideshow: slideshow,
        allowScripts: prefs.get("allowscripts", true),
        yielding: prefs.yielding
      });
    }
    catch (ex) {
      log(LOG_ERROR, "failed to run repaginate", ex);
    }
  }

  function repaginate_domain() {
    log(LOG_INFO, "repaginate_domain");
    try {
      let mm = window.gBrowser.selectedBrowser.messageManager;
      let queried = m => {
        mm.removeMessageListener("repagination:query", queried);
        log(LOG_DEBUG, "recv query " + m.data);
        if (!m.data) {
          return;
        }
        const host = window.gBrowser.selectedBrowser.currentURI.host;
        for (let i = 0; i < window.gBrowser.browsers.length; ++i) {
          let browser = window.gBrowser.getBrowserAtIndex(i);
          if (!browser) {
            continue;
          }
          if (browser.currentURI.host != host) {
            continue;
          }
          browser.messageManager.sendAsyncMessage("repagination:normal", {
            num: 0,
            slideshow: false,
            allowScripts: prefs.get("allowscripts", true),
            yielding: prefs.yielding,
            query: m.data
          });
        }
      };
      mm.addMessageListener("repagination:query", queried);
      mm.sendAsyncMessage("repagination:query");
    }
    catch (ex) {
      log(LOG_ERROR, "failed to run repaginate_domain", ex);
    }
  }

  function stop() {
    log(LOG_INFO, "stop");
    let mm = window.gBrowser.selectedBrowser.messageManager;
    mm.sendAsyncMessage("repagination:stop");
  }

  function onAll() { repaginate(); }
  function onAllDomain() { repaginate_domain(); }
  function onStop() { stop(); }
  function onLimitCommand(evt) {
    let t = evt.target;
    if (t.localName != "menuitem") {
      return;
    }
    repaginate(parseInt(t.getAttribute("value"), 10));
  }
  function onSlideCommand(evt) {
    let t = evt.target;
    if (t.localName != "menuitem") {
      return;
    }
    repaginate(parseInt(t.getAttribute("value"), 10), true);
  }

  log(LOG_INFO, "main called!");

  let frameToLog = m => log(m.data.level, m.data.message, m.data.exception);
  let frameL10N = m => {
    return _.apply(null, m.data.arguments);
  };
  window.messageManager.addMessageListener("repagination:log", frameToLog);
  window.messageManager.addMessageListener("repagination:_", frameL10N);
  let fs = "chrome://repagination/content/content-script.js?" + (+new Date());
  window.messageManager.loadFrameScript(fs, true);
  unloadWindow(window, () => {
    window.messageManager.broadcastAsyncMessage("repagination:shutdown");
    window.messageManager.removeMessageListener("repagination:log", frameToLog);
    window.messageManager.removeMessageListener("repagination:_", frameL10N);
    window.messageManager.removeDelayedFrameScript(fs);
  });

  // finish the localization
  let nodes = $$$(":-moz-any(#repagination_limit, " +
                  "#repagination_menu_limit) menuitem");
  for (let n of nodes) {
    n.setAttribute("label", _("pages.label", n.getAttribute("value")));
  }
  nodes = $$$(":-moz-any(#repagination_slide, #repagination_menu_slide) " +
              "menuitem:not([label])");
  for (let n of nodes) {
    let s = parseInt(n.getAttribute("value"), 10);
    if (s < 60) { 
      n.setAttribute("label", _("seconds.label", s));
    }
    else {
      n.setAttribute("label", _("minutes.label", parseInt(s / 60, 10)));
    }
  }
  let contextMenu = $("contentAreaContextMenu");

  let menuCascaded = {
    menu: $("repagination_menu"),
    allMenu: $("repagination_menu_nolimit"),
    allDomainMenu: $("repagination_menu_nolimit_domain"),
    stopMenu: $("repagination_menu_stop"),
    limitMenu: $("repagination_menu_limit"),
    slideMenu: $("repagination_menu_slide")
  };
  let menuPlain = {
    menu: {},
    allMenu: $("repagination_nolimit"),
    allDomainMenu: $("repagination_nolimit_domain"),
    stopMenu: $("repagination_stop"),
    limitMenu: $("repagination_limit"),
    slideMenu: $("repagination_slide")
  };
  let menuCurrent;

  prefs.observe("submenu", function(pref, value) {
    menuCurrent = value ? menuCascaded : menuPlain;
    let menuDisabled = value ? menuPlain : menuCascaded;
    for (let [,mi] in new Iterator(menuDisabled)) {
      mi.hidden = true;
    }
  }, true);

  let onContextMenu = function onContextMenu() {
    function setMenuHidden(hidden) {
      log(LOG_DEBUG, "set menu hidden = " + hidden);
    for (let [,mi] in new Iterator(menuCurrent)) {
        mi.hidden = hidden;
      }
      menuCurrent.slideMenu.hidden =
        menuCurrent.slideMenu.hidden || !prefs.showslideshow;
      menuCurrent.allDomainMenu.hidden =
        menuCurrent.allDomainMenu.hidden || !prefs.showalldomain;
    }

    log(LOG_DEBUG, "context menu showing!");
    try {
      if (window.gContextMenu.onLink &&
          /^https?$/.test(window.gContextMenu.linkURI.scheme)) {
        setMenuHidden(!checkSameOrigin(window.gContextMenu.target.ownerDocument,
                                       window.gContextMenu.linkURL));
        let body = window.gContextMenu.target.ownerDocument.body;
        if (!body.hasAttribute("repagination")) {
          menuCurrent.stopMenu.hidden = true;
        }
        return;
      }
    }
    catch (ex) {
      log(LOG_ERROR, "failed to setup menu (onLink)", ex);
    }
    try {
      setMenuHidden(true);
      let body = window.gContextMenu.target.ownerDocument.body;
      if (body.hasAttribute("repagination")) {
        menuCurrent.menu.hidden = menuCurrent.stopMenu.hidden = false;
      }
    }
    catch (ex) {
      log(LOG_ERROR, "failed to setup menu (plain)", ex);
    }
  };

  contextMenu.addEventListener("popupshowing", onContextMenu, true);
  menuCascaded.allMenu.addEventListener("command", onAll, true);
  menuPlain.allMenu.addEventListener("command", onAll, true);
  menuCascaded.allDomainMenu.addEventListener("command", onAllDomain, true);
  menuPlain.allDomainMenu.addEventListener("command", onAllDomain, true);
  menuCascaded.stopMenu.addEventListener("command", onStop, true);
  menuPlain.stopMenu.addEventListener("command", onStop, true);
  menuCascaded.limitMenu.addEventListener("command", onLimitCommand, true);
  menuPlain.limitMenu.addEventListener("command", onLimitCommand, true);
  menuCascaded.slideMenu.addEventListener("command", onSlideCommand, true);
  menuPlain.slideMenu.addEventListener("command", onSlideCommand, true);
  unloadWindow(window, function() {
    contextMenu.removeEventListener("popuphowing", onContextMenu, true);
    menuCascaded.allMenu.removeEventListener("command", onAll, true);
    menuPlain.allMenu.removeEventListener("command", onAll, true);
    menuCascaded.allDomainMenu.removeEventListener("command", onAllDomain,
                                                   true);
    menuPlain.allDomainMenu.removeEventListener("command", onAllDomain, true);
    menuCascaded.stopMenu.removeEventListener("command", onStop, true);
    menuPlain.stopMenu.removeEventListener("command", onStop, true);
    menuCascaded.limitMenu.removeEventListener("command", onLimitCommand, true);
    menuPlain.limitMenu.removeEventListener("command", onLimitCommand, true);
    menuCascaded.slideMenu.removeEventListener("command", onSlideCommand, true);
    menuPlain.slideMenu.removeEventListener("command", onSlideCommand, true);
    contextMenu = menuPlain = menuCascaded = null;
  });
  log(LOG_INFO, "all good!");
}
registerOverlay(
  "repagination.xul",
  "chrome://browser/content/browser.xul",
  main
);
registerOverlay(
  "repagination.xul",
  "chrome://navigator/content/navigator.xul",
  main
);

/* vim: set et ts=2 sw=2 : */
