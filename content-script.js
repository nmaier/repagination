/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

/* global
  addMessageListener,
  content,
  removeMessageListener,
  sendAsyncMessage,
  sendSyncMessage
*/

(function() {

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
let {Services, Promise} = Cu.import("resource://gre/modules/Services.jsm", {});
let {Task} = Cu.import("resource://gre/modules/Task.jsm", {});

const [LOG_DEBUG, LOG_INFO, LOG_ERROR] = [0, 1, 2];
const log = function(level, message, exception) {
  sendAsyncMessage("repagination:log", {
    level: level,
    message: message,
    exception: exception && {
      message: exception.message,
      fileName: exception.fileName,
      lineNumber: exception.lineNumber,
      stack: exception.stack
    }
  });
};

const _ = function() {
  return sendSyncMessage("repagination:_", {
    arguments: Array.map(arguments, e => e.toString())
  })[0];
};

const getFirstSnapshot = (doc, node, query) =>
  doc.evaluate(query, node, null, 7, null).snapshotItem(0);

const checkSameOrigin = (node, tryLoadUri) => {
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
};

const createFrame = (window, src, allowScripts, loadFun) => {
  log(LOG_INFO, "creating frame for " + src);
  if (!checkSameOrigin(window.document, src)) {
    throw new Error("same origin mismatch; frame creation denied");
  }
  let frame = window.document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.style.display = "none";
  window.document.body.appendChild(frame);
  let docShell = frame.contentWindow.QueryInterface(Ci.nsIInterfaceRequestor)
    .getInterface(Ci.nsIWebNavigation).QueryInterface(Ci.nsIDocShell);
  docShell.allowImages = false;
  docShell.allowPlugins = false;
  docShell.allowJavascript = allowScripts;

  frame.addEventListener("load", function loadHandler() {
    frame.removeEventListener("load", loadHandler, false);
    log(LOG_INFO, "frame loaded, going to process");
    try {
      loadFun(frame);
    }
    catch (ex) {
      log(LOG_ERROR, "failed to invoke callback on frame", ex);
    }
  }, false);
  frame.src = src;

  let errorCount = 0;
  let errorHandler = function() {
    log(LOG_INFO, "frame err'ed out");
    if (++errorCount > 5) {
      frame.removeEventListener("error", errorHandler, false);
      frame.removeEventListener("abort", errorHandler, false);
      log(LOG_ERROR, "frame err'ed out, giving up");
      try {
        loadFun(frame);
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
};

const Repaginator = function Repaginator(focusElement, count, allowScripts, yielding) {
  this.pageLimit = count || 0;
  this.allowScripts = allowScripts;
  this.yielding = yielding;
  this.init(focusElement);
};
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
        if (parent.localName == "a") {
          focusElement = parent;
          return;
        }
      }
      throw new Error("No focus element");
    })();

    this._window = focusElement.ownerDocument.defaultView;
  },
  buildQuery: function R_buildQuery(el) {
    function escapeXStr(str) {
      return str.replace(/'/g, "\\'");
    }

    this.query = "";

    (function buildQuery() {
      // Homestuck hack
      if(el.href.contains("mspaintadventures.com")) {
        this.query = "//center[position() = 1]/table[position() = 1]/tbody[position() = 1]/tr[position() = 2]/td[position() = 1]/table[position() = 1]/tbody[position() = 1]/tr[position() = 1]/td[position() = 1]/table[position() = 1]/tbody[position() = 1]/tr[position() = 2]/td[position() = 1]/center[position() = 1]/table[position() = 1]/tbody[position() = 1]/tr[position() = 6]/td[position() = 1]/table[position() = 1]/tbody[position() = 1]/tr[position() = 1]/td[position() = 1]/font[position() = 1]/a[position() = 1]";
        this.numberToken = /(\[@href='.*)(\d+)(.*?'\])/;
        return;
      }

      // See if the anchor has an ID
      // Note: cannot use the id() xpath function here, as there might
      // be duplicate ids
      if (el.id) {
        this.query = "//a[@id='" + escapeXStr(el.id) + "']";
        this.numberToken = /(\[@id='.*?)(\d+)(.*?'\])/;
        return;
      }

      // See if the document has a link rel="..." pointing to the same place
      let linkEl = getFirstSnapshot(el.ownerDocument, el.ownerDocument,
                                    "//head//link[@href='" +
                                      escapeXStr(el.href) + "']");
      if (linkEl) {
        let rel = linkEl.getAttribute("rel") || "";
        if (rel.trim()) {
          this.query = "/html/head//link[@rel='" + escapeXStr(rel) + "']";
          // no point in checking for numbers
          this.attemptToIncrement = false;
          log(LOG_DEBUG, "using link[@rel]");
          return;
        }
      }

      // Find an id in the ancestor chain, or alternatively a class
      // that we may operate on
      (function findPathPrefix() {
        let pieces = [];
        for (let pn = el.parentNode; pn; pn = pn.parentNode) {
          if (pn.localName == "body") {
            break;
          }
          if (pn.id) {
            log(LOG_DEBUG, "got id: " + pn.id);
            pieces.unshift("//" + pn.localName + "[@id='" +
                           escapeXStr(pn.id) + "']");
            break; // one id is enough
          }
          if (pn.className) {
            log(LOG_DEBUG, "got class: " + pn.className);
            pieces.unshift("//" + pn.localName + "[@class='" +
                           escapeXStr(pn.className) + "']");
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
          this.query += "//a[.='" + escapeXStr(text) + "']";
          this.numberToken = /(a\[.='.*?)(\d+)(.*?\])/;
          log(LOG_DEBUG, "using text");
          return;
        }

        // Second: see if it has a child with a @src we may use
        let srcEl = getFirstSnapshot(el.ownerDocument, el, "child::*[@src]");
        if (srcEl) {
          let src = srcEl.getAttribute("src") || "";
          if (src.trim()) {
            this.query += "//" + srcEl.localName + "[@src='" + escapeXStr(src) +
              "']/ancestor::a";
            this.numberToken = /(\[@src='.*?)(\d+)(.*?'\])/;
            log(LOG_DEBUG, "using @src");
            return;
          }
        }

        // Third: See if there is a child with a @value we may use
        srcEl = getFirstSnapshot(el.ownerDocument, el, "child::*[@value]");
        if (srcEl) {
          let val = srcEl.getAttribute("value") || "";
          if (val.trim()) {
            this.query += "//" + srcEl.localName + "[@value='" +
              escapeXStr(val) + "']/ancestor::a";
            this.numberToken = /(\[@value='.*?)(\d+)(.*?'\])/;
            log(LOG_DEBUG, "using @value");
            return;
          }
        }

        // Fourth: See if there is rel=next or rel=prev
        let rel = (el.getAttribute("rel") || "").trim();
        if (rel && (rel.contains("next") || rel.contains("prev"))) {
          this.query += "//a[@rel='" + escapeXStr(rel) + "']";
          // no point in checking for numbers
          this.attemptToIncrement = false;
          log(LOG_DEBUG, "using a[@rel]");
          return;
        }

        // Fifth: See if there is a class we may use
        if (el.className) {
          this.query += "//a[@class='" + escapeXStr(el.className) + "']";
          this.numberToken = /(\[@class='.*?)(\d+)(.*?'\])/;
          log(LOG_DEBUG, "using a[@class]");
          return;
        }

        throw new Error("No anchor expression found!");
      }).call(this);
    }).call(this);


    // We're after the last result
    this.query = "(" + this.query + ")[last()]";
    log(LOG_INFO, "query: " + this.query);
  },
  setTitle: function R_setTitle() {
    let wnd = this._window;
    if (!wnd) {
      return;
    }
    if (!this._title) {
      this._title = wnd.document.title;
    }
    if (this.pageLimit) {
      wnd.document.title =
        _("repagination_limited", this.pageCount, this.pageLimit);
    }
    else if (this.pageCount > 0) {
      wnd.document.title = _("repagination_unlimited", this.pageCount);
    }
    else {
      wnd.document.title = _("repagination_running");
    }
  },
  restoreTitle: function R_restoreTitle() {
    let wnd = this._window;
    if (this._title && wnd) {
      wnd.document.title = this._title;
      delete this._title;
    }
  },
  unregister: function R_unregister() {
    sendAsyncMessage("repagination:unregister", {id: this.frameId});
    if (this._window) {
      this._window.document.body.removeAttribute("repagination");
      this._window.removeEventListener("beforeunload", this.unload, true);
    }
  },
  repaginate: function R_repaginate() {
    this.setTitle();
    let wnd = this._window;
    if (!wnd) {
      log(LOG_INFO, "window is gone!");
      return;
    }
    this.frameId = wnd.QueryInterface(Ci.nsIInterfaceRequestor).
                       getInterface(Ci.nsIDOMWindowUtils).
                       outerWindowID;
    sendAsyncMessage("repagination:register", {id: this.frameId});
    this.unload = () => {
      log(LOG_DEBUG, "unload");
      this.unregister();
    };
    wnd.addEventListener("beforeunload", this.unload, true);

    try {
      let node = wnd.document.evaluate(
        this.query, wnd.document, null, 9, null).singleNodeValue;
      if (!node) {
        throw new Error("no node");
      }
      wnd.document.body.setAttribute("repagination", "true");
      createFrame(wnd, node.href, this.allowScripts, frame => {
        this.loadNext(frame, 0);
      });
    }
    catch (ex) {
      this.unregister();
      this.restoreTitle();
      log(LOG_ERROR, "repaginate failed", ex);
    }
  },
  incrementQuery: function R_incrementQuery() {
    return this.query.replace(this.numberToken, function(g, pre, num, post) {
      return pre + (parseInt(num, 10) + 1) + post;
    });
  },
  loadNext: function R_loadNext(element, delay) {
    if (!this.yielding) {
      if (delay > 0) {
        log(LOG_DEBUG, "delaying (sto) " + delay);
        content.setTimeout(() => this.loadNext(element, 0), delay);
        return;
      }

      try {
        for (let f in this._loadNext_gen.bind(this, element)()) {
          if (!f) {
            break;
          }
        }
      }
      catch (ex) {
        log(LOG_ERROR, "failed to process loadNext (non-yielding)", ex);
      }
      return;
    }

    Task.spawn(function*() {
      try {
        if (delay > 0) {
            yield new Promise(r => {
              log(LOG_DEBUG, "delaying " + delay);
              content.setTimeout(() => {
                log(LOG_DEBUG, "invoke " + delay);
                r();
              }, delay);
            });
        }
        let gen = this._loadNext_gen(element);
        let deadline = +(new Date()) + 60;
        for (let r in gen) {
          if (!r) {
            break;
          }
          if (deadline < +(new Date())) {
            yield new Promise(r => {
              content.setTimeout(() => r(), 0);
            });
            deadline = +(new Date()) + 60;
          }
        }
      }
      catch (ex) {
        log(LOG_ERROR, "failed to iterate loadNext", ex);
      }
    }.bind(this));
  },
  _loadNext_gen: function R__loadNext_gen(element) {
    try {
      let ownerDoc = element.ownerDocument;
      if (!ownerDoc || !this._window) {
        yield true;
        this.unregister();
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
        Array.forEach(doc.querySelectorAll("script"),
                      s => s.parentNode.removeChild(s));
        Array.forEach(doc.querySelectorAll("noscript"),
                      s => s.parentNode.removeChild(s));

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
        }
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
          log(LOG_DEBUG, "inc:" + this.query + " orig:" + savedQuery);
          this.query = savedQuery;
          node = doc.evaluate(this.query, doc, null, 9, null).singleNodeValue;
          this.attemptToIncrement = false;
        }
        if (!node) {
          throw new Error("no next node found for query: " + this.query);
        }
        if (loc && loc == node.href) {
          throw new Error("location did not change for query" + this.query);
        }

        this.setTitle();
        log(LOG_INFO, "next please");
        createFrame(ownerDoc.defaultView, node.href, this.allowScripts,
                    frame => {
          if (!this._window || this._window.closed) {
            log(LOG_DEBUG, "self is gone by now");
            this.unregister();
            this.restoreTitle();
            return;
          }
          if (this.slideshow && this.seconds) {
            log(LOG_INFO, "slideshow; delay: " + this.seconds * 1000);
            this.loadNext(frame, this.seconds * 1000);
          }
          else {
            log(LOG_INFO, "regular; no-delay");
            this.loadNext(frame, 0);
          }
        });
      }
      catch (ex) {
        log(LOG_INFO, "loadNext complete", ex);
        this.unregister();
        this.restoreTitle();
      }
    }
    finally {
      element.parentElement.removeChild(element);
    }
  }
};
Object.seal(Repaginator.prototype);

const Slideshow = function Slideshow(focusElement, seconds, allowScripts, yielding) {
  this.seconds = seconds || 0;
  this.slideshow = true;
  this.allowScripts = allowScripts;
  this.yielding = yielding;
  this.init(focusElement);
  this.buildQuery(focusElement);
};
Slideshow.prototype = Repaginator.prototype;

const fe = () => {
  let fm = Cc["@mozilla.org/focus-manager;1"].getService(Ci.nsIFocusManager);
  let focusedWindow = {};
  let elt = fm.getFocusedElementForWindow(content, true, focusedWindow);
  return elt;
};

const repaginate = m => {
  let {num, slideshow, allowScripts, yielding} = m.data;
  try {
    let Ctor = slideshow ? Slideshow : Repaginator;
    let rep;
    if ("query" in m.data) {
      let el = getFirstSnapshot(content.document, content.document,
                                m.data.query);
      if (!el) {
        log(LOG_DEBUG, "did not find explicit query element");
        return;
      }
      rep = new Ctor(el, num, allowScripts, yielding);
      rep.query = m.data.query;
    }
    else {
      let el = fe();
      rep = new Ctor(fe(), num, allowScripts, yielding);
      rep.buildQuery(el);
    }
    rep.repaginate();
  }
  catch (ex) {
    log(LOG_ERROR, "Failed to run repaginate", ex);
  }
};

const query = () => {
  let el = fe();
  let rv =  new Repaginator(el);
  rv.buildQuery(el);
  sendAsyncMessage("repagination:query", rv.query);
};

const stop = () => {
  try {
    if (!content) {
      return;
    }
    let body = content.document.getElementsByTagName("body")[0];
    if (body) {
      body.removeAttribute("repagination");
    }
  }
  catch (ex) {
    log(LOG_ERROR, "failed to stop repagination", ex);
  }
};

const shutdown = () => {
  removeMessageListener("repagination:normal", repaginate);
  removeMessageListener("repagination:query", query);
  removeMessageListener("repagination:stop", stop);
  removeMessageListener("repagination:shutdown", shutdown);
};

addMessageListener("repagination:normal", repaginate);
addMessageListener("repagination:query", query);
addMessageListener("repagination:stop", stop);
addMessageListener("repagination:shutdown", shutdown);

log(LOG_DEBUG, "Framescript loaded!");

})(); // "module"

/* vim: set et ts=2 sw=2 : */
