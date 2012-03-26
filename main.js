/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

// l10n
XPCOMUtils.defineLazyGetter(this, "strings", (function() 
  Services.strings.createBundle("chrome://repagination/locale/repagination.properties")));
function _(id) {
  let args = Array.slice(arguments, 1);
  if (args.length) {
    return strings.formatStringFromName(id, args, args.length);
  }
  return strings.GetStringFromName(id);
};


function getFirstSnapshot(doc, node, query) doc
  .evaluate(query, node, null, 7, null)
  .snapshotItem(0);

function checkSameOrigin(node, tryLoadUri) {
  try {
    if (!(tryLoadUri instanceof Ci.nsIURI)) {
      tryLoadUri = Services.io.newURI(tryLoadUri, null, null);
    }
    if (tryLoadUri.schemeIs("data")) {
      return true;
    }
    node.nodePrincipal.checkMayLoad(tryLoadUri, false);
    return true;
  }
  catch (ex) {
    log(LOG_DEBUG, "denied load of " + (tryLoadUri.spec || tryLoadUri), ex);
    return false;
  }
}

function createFrame(window, src, loadFun) {
  log(LOG_INFO, "creating frame for " + src);
  if (!checkSameOrigin(window.document, src)) {
    throw new Error("same origin mismatch; frame creation denied");
  }
  let frame = window.document.createElement("iframe");
  frame.style.display = "none";
  window.document.body.appendChild(frame);
  let docShell = frame.contentWindow.QueryInterface(Ci.nsIInterfaceRequestor)
    .getInterface(Ci.nsIWebNavigation).QueryInterface(Ci.nsIDocShell);
  docShell.allowImages = false;
  docShell.allowPlugins = false;
  docShell.allowDNSPrefetch = false;

  frame.src = src;
  frame.addEventListener("load", function loadHandler() {
    frame.removeEventListener("load", loadHandler, false);
    log(LOG_INFO, "frame loaded, going to process");
    try {
      loadFun.call(frame);
    }
    catch (ex) {
      log(LOG_ERROR, "failed to invoke callback on frame", ex);
    }
  }, false);
  let errorCount = 0;
  let errorHandler = function(evt) {
    log(LOG_INFO, "frame err'ed out");
    if (++errorCount > 5) {
      frame.removeEventListener("error", errorHandler, false);
      frame.removeEventListener("abort", errorHandler, false);
      log(LOG_ERROR, "frame err'ed out, giving up");
      try {
        loadFun.call(frame);
      }
      catch (ex) {
        log(LOG_ERROR, "failed to invoke callback on frame", ex);
      }
      return;
    }
    if (frame.history) {
      frame.history.reload();
    }
    else {
      frame.src = src;
    }
  };
  frame.addEventListener("error", errorHandler, false);
  frame.addEventListener("abort", errorHandler, false);
  
  return frame;
}

function Repaginator(focusElement, count) {
  this.pageLimit = count || 0;
  this.init(focusElement);
  this.buildQuery(focusElement);
}
Repaginator.prototype = {
  slideshow: false,
  pageLimit: 0,
  seconds: 0,
  pageCount: 0,
  attemptToIncrement: true,

  init: function R_init(focusElement) {
    // find anchor
    (function findInitialAnchor() {
      for (let parent = focusElement; parent; parent = parent.parentNode) {
        if (parent.localName = "a") {
          focusElement = parent;
          return;
        }
      }
      throw new Error("No focus element");
    })();

    this._window = weak(focusElement.ownerDocument.defaultView);
  },
  buildQuery: function R_buildQuery(el) {
    this.query = "";

    // Note: cannot use the id() xpath function here, as there might
    // be duplicate ids
    if (el.id) {
      this.query = "//a[@id='" + el.id + "']"; 
      this.numberToken = /(\[@id='.*?)(\d+)(.*?'\])/;
    }
    else {
      // Find an id in the ancestor chain, or alternatively a class
      // that we may operate on
      (function findPathPrefix() {
        let pieces = [];
        for (let parent = el.parentNode; parent; parent = parent.parentNode) {
          if (parent.id) {
            log(LOG_DEBUG, "got id: " + parent.id);
            pieces.unshift("//" + parent.localName + "[@id='" + parent.id + "']");
            break; // one id is enough
          }
          if (parent.className) {
            log(LOG_DEBUG, "got class: " + parent.className);
            pieces.unshift("//" + parent.localName + "[@class='" + parent.className + "']");
          }
        }
        this.query = pieces.join("");
        log(LOG_DEBUG, "findPathPrefix result: " + this.query);
      }).call(this);

      // find the anchor
      (function findAnchor() {
        let text = el.textContent;

        // First: try the node text
        if (text.trim()) {
          this.query += "//a[.='" + text + "']";
          this.numberToken = /(a\[.='.*?)(\d+)(.*?\])/;
          log(LOG_DEBUG, "using text");
          return;
        }

        // Second: see if it has a child with a @src we may use
        let srcEl = getFirstSnapshot(el.ownerDocument, el, "child::*[@src]");
        if (srcEl) {
          let src = srcEl.getAttribute("src") || "";
          if (src.trim()) {
            this.query += "//" + srcEl.localName + "[@src='" + src + "‘]/ancestor::a";
            this.numberToken = /(\[@src='.*?)(\d+)(.*?'\])/;
            log(LOG_DEBUG, "using @src");
            return;
          }
        }

        // Third: See if there is a child with a @value we may use
        let srcEl = getFirstSnapshot(el.ownerDocument, el, "child::*[@value]");
        if (srcEl) {
          let val = srcEl.getAttribute("value") || "";
          if (val.trim()) {
            this.query += "//" + srcEl.localName + "[@value='" + val + "‘]/ancestor::a";
            this.numberToken = /(\[@value='.*?)(\d+)(.*?'\])/;
            log(LOG_DEBUG, "using @value");
            return;
          }
        }

        throw new Error("No anchor expression found!");
      }).call(this);
    }


    // We're after the last result
    this.query = "(" + this.query + ")[last()]";
    log(LOG_INFO, "query: " + this.query);
  },
  setTitle: function R_setTitle() {
    let wnd = this._window.get();
    if (!wnd) {
      return;
    }
    if (!this._title) {
      this._title = wnd.document.title;
    }
    if (this.pageLimit) {
      wnd.document.title = _("repagination_limited", this.pageCount, this.pageLimit);
    }
    else if (this.pageCount > 0) {
      wnd.document.title = _("repagination_unlimited", this.pageCount);
    }
    else {
      wnd.document.title = _("repagination_running");
    }
  },
  restoreTitle: function R_restoreTitle() {
    let wnd = this._window.get();
    if (this._title && wnd) {
      wnd.document.title = this._title;
      delete this._title;
    }
  },
  repaginate: function R_repaginate() {
    this.setTitle();
    let wnd = this._window.get();
    if (!wnd) {
      log(LOG_INFO, "window is gone!");
      return;
    }
    try {
      let node = wnd.document.evaluate(this.query, wnd.document, null, 9, null).singleNodeValue;
      if (!node) {
        throw new Error("no node");
      }
      wnd.document.body.setAttribute("repagination", "true");
      let self = this;
      let frame = createFrame(wnd, node.href, function() {
        self.loadNext(this);
      });
    }
    catch (ex) {
      this.restoreTitle();
      wnd.document.body.removeAttribute("repagination");
      log(LOG_ERROR, "repaginate failed", ex);
    }
  },
  incrementQuery: function R_incrementQuery() this.query.replace(
    this.numberToken,
    function(g, pre, num, post) pre + (parseInt(num, 100) + 1) + post
    ),
  loadNext: function R_loadNext(element) {
    try {
      const {CoThreadInterleaved} = require("cothreads");
      new CoThreadInterleaved(this._loadNext_gen.bind(this, element)(), 1).start();
    }
    catch (ex) {
      log(LOG_ERROR, "failed to launch loadNext CoThread", ex);
    }
  },
  _loadNext_gen: function R__loadNext_gen(element) {
    let ownerDoc = element.ownerDocument;
    if (!ownerDoc || !this._window.get()) {
      yield true;
      element.parentNode.removeChild(element);
      this.restoreTitle();
      log(LOG_INFO, "gone, giving up!");
      return;
    }

    try {
      if (!ownerDoc.body.hasAttribute("repagination")) {
        throw new Error("not running");
      }

      var doc = element.contentDocument;
      if (!checkSameOrigin(ownerDoc, doc.defaultView.location)) {
        throw new Error("not in the same origin anymore");
      }
      this.pageCount++;

      // Remove scripts from frame
      // The scripts should already be present in the parent (first page)
      // Duplicate scripts would cause more havoc (performance-wise) than
      // behaviour failures due to missing scripts
      // Note: This is NOT a security mechanism, but a performance thing.
      Array.forEach(doc.querySelectorAll("script"), function(s) s.parentNode.removeChild(s));
      Array.forEach(doc.querySelectorAll("noscript"), function(s) s.parentNode.removeChild(s));

      yield true;

      // Do the dirty deed
      // Note: same-origin checked; see above
      if (this.slideshow) {
        log(LOG_INFO, "replacing content (slideshow)");
        ownerDoc.body.innerHTML = doc.body.innerHTML;
        ownerDoc.body.setAttribute("repagination", "true");
      }
      else {
        log(LOG_INFO, "inserting content (normal)");
        // Remove non-same-origin iframes, such as ad iframes
        // Otherwise we might create a shitload of (nearly) identical frames
        // which might even kill the browser
        if (!this.pageLimit || this.pageLimit > 10) {
          log(LOG_INFO, "removing non-same-origin iframes to avoid dupes");
          let host = ownerDoc.defaultView.location.hostName;
          Array.forEach(doc.querySelectorAll("iframe"), function(f) {
            if (f.contentWindow.location.hostname != host) {
              f.parentNode.removeChild(f);
            }
          });
          yield true;
        }
        for (let c = doc.body.firstChild; c; c = c.nextSibling) {
          ownerDoc.body.appendChild(ownerDoc.importNode(c, true));
          yield true;
        }
      }

      // Synthesize load events to trigger other add-ons and
      // page scripts.
      if (ownerDoc.defaultView) {
        log(LOG_DEBUG, "about to fire load events");

        let levt = ownerDoc.createEvent("Events");
        levt.initEvent("DOMContentLoaded", true, true);
        ownerDoc.defaultView.dispatchEvent(levt);
        log(LOG_DEBUG, "fired DOMContentLoaded");

        levt = ownerDoc.createEvent("Events");
        levt.initEvent("load", true, true);
        ownerDoc.defaultView.dispatchEvent(levt);
        log(LOG_DEBUG, "fired load");
      };
      yield true;

      if (this.pageLimit && this.pageCount >= this.pageLimit) {
        throw new Error("done");
      }

      let savedQuery;
      if (this.attemptToIncrement) {
        log(LOG_DEBUG, "attempting to increment query");
        let nq = this.incrementQuery();
        if (nq == this.query) {
          log(LOG_DEBUG, "query did not increment");
          this.attemptToIncrement = false;
        }
        else {
          log(LOG_DEBUG, "query did increment");
          savedQuery = this.query;
          this.query = nq;
        }
      }
      let node = doc.evaluate(this.query, doc, null, 9, null).singleNodeValue;
      let loc = (doc.location || {}).href || null;
      if (this.attemptToIncrement && (!node || node.href == loc)) {
        log(LOG_DEBUG, "no result after incrementing; restoring");
        this.query = savedQuery;
        node = doc.evaluate(this.query, doc, null, 9, null).singleNodeValue;
        this.attemptToIncrement = false;
      }
      if (!node) {
        throw new Error("no next node found");
      }
      if (loc && loc == node.href) {
        throw new Error("location did not change");
      }

      this.setTitle();
      log(LOG_INFO, "next please");
      let self = weak(this);
      let frame = createFrame(ownerDoc.defaultView, node.href, function continueLoadNext() {
        self = self.get();
        if (!self) {
          log(LOG_DEBUG, "self is gone by now");
          return;
        }
        if (self.slideshow && self.seconds) {
          log(LOG_INFO, "slideshow; delay: " + self.seconds * 1000);
          self.timer = new Instances.Timer({
            observe: function() {
              log(LOG_DEBUG, "timer fired!");
              try {
                self.loadNext(frame);
              }
              catch (ex) {
                log(LOG_ERROR, "timer died a horrible death", ex);
              }
              delete self.timer;
            }
          }, self.seconds * 1000, 0);
        }
        else {
          log(LOG_INFO, "regular; no-delay");
          self.loadNext(this);
        }
      });
    }
    catch (ex) {
      log(LOG_INFO, "loadNext complete", ex);
      this.restoreTitle();
      ownerDoc.body.removeAttribute("repagination");
    }
    if (element && element.parentNode) {
      yield true;
      element.parentNode.removeChild(element);
    }
  }
};
Object.seal(Repaginator.prototype);

function DomainRepaginator(window, focusElement) {
  this.init(focusElement);
  this.buildQuery(focusElement);
  let wnd = this._window.get();

  this._internalPaginators = [];
  let host = wnd.location.hostname;
  for (let i = 0; i < window.gBrowser.browsers.length; ++i) {
    try {
      let b = window.gBrowser.getBrowserAtIndex(i);
      if (b.currentURI.host != host) {
        continue;
      }
      let document = b.contentDocument;
      let node = document.evaluate(
        this.query,
        document,
        null,
        9,
        null
        ).singleNodeValue;
      if (!node) {
        continue;
      }
      this._internalPaginators.push(new DomainRepaginator.InternalRepaginator(node, this.query));
    }
    catch (ex) {
      log(LOG_ERROR, "Failed to process browser at " + i, ex);
    }
  }
}
DomainRepaginator.prototype = {
  __proto__: Repaginator.prototype,
  repaginate: function() {
    for each (let ip in this._internalPaginators) {
      ip.repaginate();
    }
    delete this._internalPaginators;
  }
}
Object.seal(DomainRepaginator.prototype);
DomainRepaginator.InternalRepaginator = function(focusElement, query) {
  this.init(focusElement);
  this.query = query;
};
DomainRepaginator.InternalRepaginator.prototype = Repaginator.prototype;

function Slideshow(focusElement, seconds) {
  this.seconds = seconds || 0;
  this.slideshow = true;
  this.init(focusElement);
  this.buildQuery(focusElement);
}
Slideshow.prototype = Repaginator.prototype;

const {registerOverlay, unloadWindow} = require("windows");
registerOverlay(
  "repagination.xul",
  "chrome://browser/content/browser.xul",
  function main(window, document) {
    function $(id) document.getElementById(id);
    function $$(q) document.querySelector(q);
    function $$$(q) document.querySelectorAll(q);
    function fe() document.commandDispatcher.focusedElement;

    function repaginate(num, slideshow) {
      log(LOG_INFO, "repaginate: " + num + "/" + slideshow);
      try {
        let ctor = slideshow ? Slideshow : Repaginator;
        new ctor(fe(), num).repaginate();
      }
      catch (ex) {
        log(LOG_ERROR, "failed tu run repaginate", ex);
      }
    }
    function repaginate_domain() {
      log(LOG_INFO, "repaginate_domain");
      try {
        new DomainRepaginator(window, fe()).repaginate();
      }
      catch (ex) {
        log(LOG_ERROR, "failed tu run repaginate_domain", ex);
      }
    }
    function stop() {
      log(LOG_INFO, "stop");
      if (!window.gContextMenu || !window.gContextMenu.focusedElement) {
        let body = window.content.document.getElementsByTagName("body")[0];
        if (body) {
          body.removeAttribute("repagination");
        }
        return;
      }

      let body = window.gContextMenu.target.ownerDocument.getElementsByTagName("body")[0];
      if (body) {
        body.removeAttribute("repagination");
      }
    }

    function onContextMenu() {
      function setMenuHidden(hidden) {
        log(LOG_DEBUG, "set menu hidden = " + hidden);
        for (let n = menu.menupopup.firstChild; n; n = n.nextSibling) {
          n.hidden = hidden;
        }
        menu.hidden = hidden;
      }

      log(LOG_DEBUG, "context menu showing!");
      try {
        if (window.gContextMenu.onLink
          && /^https?:/.test(fe().href)) {
          setMenuHidden(!checkSameOrigin(fe().ownerDocument, fe().href));
          if (!window.gContextMenu.target.ownerDocument.body.hasAttribute("repagination")) {
            stopMenu.hidden = true;
          }
          return;
        }
      }
      catch (ex) {
        log(LOG_ERROR, "failed to setup menu (onLink)", ex);
      }
      try {
        setMenuHidden(true);
        if (window.gContextMenu.target.ownerDocument.body.hasAttribute("repagination")) {
          menu.hidden = stopMenu.hidden = false;
        }
      }
      catch (ex) {
        log(LOG_ERROR, "failed to setup menu (plain)", ex);
      }
    }

    function onAll() repaginate();
    function onAllDomain() repaginate_domain();
    function onStop() stop();
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

    // finish the localization
    for (let [,n] in Iterator($$$("#repagination_flat_limit_menu menuitem"))) {
      n.setAttribute("label", _("pages.label", n.getAttribute("value")));
    }
    for (let [,n] in Iterator($$$("#repagination_flat_nolimit_slide menuitem:not([label])"))) {
      let s = parseInt(n.getAttribute("value"), 10);
      if (s < 60) { 
        n.setAttribute("label", _("seconds.label", s));
      }
      else {
        n.setAttribute("label", _("minutes.label", parseInt(s / 60, 10)));
      }
    }

    let menu = $("repagination_menu");
    let contextMenu = $("contentAreaContextMenu");
    let allMenu = $("repagination_flatten_nolimit");
    let allDomainMenu = $("repagination_flatten_nolimit_domain");
    let stopMenu = $("repagination_stop");
    let limitMenu = $("repagination_flat_limit_menu");
    let slideMenu = $("repagination_flat_nolimit_slide");

    contextMenu.addEventListener("popupshowing", onContextMenu, true);
    allMenu.addEventListener("command", onAll, true);
    allDomainMenu.addEventListener("command", onAllDomain, true);
    stopMenu.addEventListener("command", onStop, true);
    limitMenu.addEventListener("command", onLimitCommand, true);
    slideMenu.addEventListener("command", onSlideCommand, true);
    unloadWindow(window, function() {
      contextMenu.removeEventListener("popuphowing", onContextMenu, true);
      allMenu.removeEventListener("command", onAll, true);
      allDomainMenu.removeEventListener("command", onAllDomain, true);
      stopMenu.removeEventListener("command", onStop, true);
      limitMenu.removeEventListener("command", onLimitCommand, true);
      slideMenu.removeEventListener("command", onSlideCommand, true);
      menu = contextMenu = allMenu = allDomainMenu = stopMenu = limitMenu = slideMenu = null;
    });
    log(LOG_INFO, "all good!");
});

/* vim: set et ts=2 sw=2 : */
