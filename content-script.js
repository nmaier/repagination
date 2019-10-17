/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

{
console.log("Framescript loaded!");
let port = browser.runtime.connect();

var focusElement = null;

let _ = function () {
  let args = Array.from(arguments).map(e => e.toString());
  return browser.i18n.getMessage(args[0], args.slice(1));
}

let equalLinks = (left, right) =>
  left.pathname === right.pathname &&
  left.search === right.search &&
  left.host === right.host &&
  left.protocol === right.protocol;

let getFirstSnapshot = (doc, node, query) =>
  doc.evaluate(query, node, null, 7, null).snapshotItem(0);

let createPageRequest = (srcurl, allowScripts, loadFun) => {
  let errorCount = 0;
  function sendRequest() {
    var xhr = new XMLHttpRequest();
    xhr.onload  =  function()  {
      if (xhr.status == 200) {
        console.info("XHR loaded, going to process");
        try {
          loadFun(xhr.responseXML);
        }
        catch (ex) {
          console.error("failed to invoke callback on XHR", ex);
        }
      } else if (++errorCount <= 5) {
        console.info("XHR err'ed out, retrying");
        setTimeout(function(){ sendRequest(); }, 500 * (2**errorCount));
      } else {
        console.error("XHR err'ed out, giving up");
      }
    }
    xhr.open('GET', srcurl);
    xhr.responseType = "document";
    xhr.send();
  }
  sendRequest();
};

let Repaginator = function Repaginator(count, allowScripts, yielding) {
  this.pageLimit = count || 0;
  this.allowScripts = allowScripts;
  this.yielding = yielding;
  this.init();
};
Repaginator.prototype = {
  slideshow: false,
  pageLimit: 0,
  seconds: 0,
  pageCount: 0,
  attemptToIncrement: true,

  init: function R_init() {
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
  },
  buildQuery: function R_buildQuery(el) {
    function escapeXStr(mystr) {
      return mystr.replace(/'/g, "\\'");
    }

    this.query = "";

    (function buildQuery() {
      // Homestuck hack
      if(el.href && el.href.includes("mspaintadventures.com")) {
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
          console.log("using link[@rel]");
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
            console.log("got id: " + pn.id);
            pieces.unshift("//" + pn.localName + "[@id='" +
                           escapeXStr(pn.id) + "']");
            break; // one id is enough
          }
          if (pn.className) {
            console.log("got class: " + pn.className);
            pieces.unshift("//" + pn.localName + "[@class='" +
                           escapeXStr(pn.className) + "']");
            break;
          }
        }
        this.query = pieces.join("");
        console.log("findPathPrefix result: " + this.query);
      }).call(this);

      // find the anchor
      (function findAnchor() {
        let text = el.textContent;

        // See if there is rel=next or rel=prev
        let rel = (el.getAttribute("rel") || "").trim();
        if (rel && (rel.includes("next") || rel.includes("prev"))) {
          this.query += "//a[@rel='" + escapeXStr(rel) + "']";
          // no point in checking for numbers
          this.attemptToIncrement = false;
          console.log("using a[@rel]");
          return;
        }

        // Try the node text
        if (text.trim()) {
          this.query += "//a[.='" + escapeXStr(text) + "']";
          this.numberToken = /(a\[.='.*?)(\d+)(.*?\])/;
          console.log("using text");
          return;
        }

        // See if it has a descendant with a @src we may use
        let srcEl = getFirstSnapshot(el.ownerDocument, el, "descendant::*[@src]");
        if (srcEl) {
          let src = srcEl.getAttribute("src") || "";
          if (src.trim()) {
            this.query += "//" + srcEl.localName + "[@src='" + escapeXStr(src) +
              "']/ancestor::a";
            this.numberToken = /(\[@src='.*?)(\d+)(.*?'\])/;
            console.log("using @src");
            return;
          }
        }

        // See if there is a descendant with a @value we may use
        srcEl = getFirstSnapshot(el.ownerDocument, el, "descendant::*[@value]");
        if (srcEl) {
          let val = srcEl.getAttribute("value") || "";
          if (val.trim()) {
            this.query += "//" + srcEl.localName + "[@value='" +
              escapeXStr(val) + "']/ancestor::a";
            this.numberToken = /(\[@value='.*?)(\d+)(.*?'\])/;
            console.log("using @value");
            return;
          }
        }

        // See if there is a class we may use
        if (el.className) {
          this.query += "//a[@class='" + escapeXStr(el.className) + "']";
          this.numberToken = /(\[@class='.*?)(\d+)(.*?'\])/;
          console.log("using a[@class]");
          return;
        }

        // See if there is a descendant with an id we may use
        srcEl = getFirstSnapshot(el.ownerDocument, el, "descendant::*[@id]");
        if (srcEl) {
          let val = srcEl.getAttribute("id") || "";
          if (val.trim()) {
            this.query += "//" + srcEl.localName + "[@id='" +
              escapeXStr(val) + "']/ancestor::a";
            this.numberToken = /(\[@value='.*?)(\d+)(.*?'\])/;
            console.log("using descendant class");
            return;
          }
        }

        throw new Error("No anchor expression found!");
      }).call(this);
    }).call(this);


    // We're after the last result
    this.query = "(" + this.query + ")[last()]";
    console.info("query: " + this.query);
  },
  setTitle: function R_setTitle() {
    if (this.pageLimit) {
      document.title =
        _("repagination_limited", this.pageCount, this.pageLimit);
    }
    else if (this.pageCount > 0) {
      document.title = _("repagination_unlimited", this.pageCount);
    }
    else {
      document.title = _("repagination_running");
    }
  },
  restoreTitle: function R_restoreTitle() {
    if("_title" in this) {
      document.title = this._title;
      delete this._title;
    }
  },
  unregister: function R_unregister() {
    port.postMessage({msg: "unregister"});
    document.body.removeAttribute("repagination");
  },
  repaginate: function R_repaginate() {
    this._title = document.title;
    this.setTitle();
    try {
      let node = document.evaluate(
        this.query, document, null, 9, null).singleNodeValue;
      if (!node) {
        throw new Error("no node");
      }
      document.body.setAttribute("repagination", "true");
      createPageRequest(node.href, this.allowScripts, frame => {
        this.loadNext(node.href, frame, 0);
      });
    }
    catch (ex) {
      this.unregister();
      this.restoreTitle();
      console.error("repaginate failed", ex);
    }
  },
  incrementQuery: function R_incrementQuery() {
    return this.query.replace(this.numberToken, function(g, pre, num, post) {
      return pre + (parseInt(num, 10) + 1) + post;
    });
  },
  loadNext: function R_loadNext(src, element, delay) {
    if (delay > 0) {
      console.log("delaying (sto) " + delay);
      setTimeout(() => this.loadNext(src, element, 0), delay);
      return;
    }

    try {
      this._loadNext_gen.bind(this, src, element)();
    } catch (ex) {
      console.error("failed to process loadNext (non-yielding)", ex);
    }
    return;
  },
  _loadNext_gen: function R__loadNext_gen(src, element) {
    let ownerDoc = document;

    try {
      if (!ownerDoc.body.hasAttribute("repagination")) {
        throw new Error("not running");
      }

      var doc = element;
      this.pageCount++;

      // Remove scripts from frame
      // The scripts should already be present in the parent (first page)
      // Duplicate scripts would cause more havoc (performance-wise) than
      // behaviour failures due to missing scripts
      // Note: This is NOT a security mechanism, but a performance thing.
      doc.querySelectorAll("script").forEach(s => s.parentNode.removeChild(s));
      doc.querySelectorAll("style").forEach(s => s.parentNode.removeChild(s));

      // Do the dirty deed
      if (this.slideshow) {
        console.info("replacing content (slideshow)");
        // this should be safe since innerHTML returns serialized HTML
        ownerDoc.body.innerHTML = doc.body.innerHTML;
        ownerDoc.body.setAttribute("repagination", "true");
      }
      else {
        console.info("inserting content (normal)");
        // Remove non-same-origin iframes, such as ad iframes
        // Otherwise we might create a shitload of (nearly) identical frames
        // which might even kill the browser
        if (!this.pageLimit || this.pageLimit > 10) {
          console.info("removing non-same-origin iframes to avoid dupes");
          let host = ownerDoc.defaultView.location.hostName;
          doc.querySelectorAll("iframe").forEach(function(f) {
            var url = new URL(f.src, ownerDoc.defaultView.location.href);
            if (url.hostname != host) {
              f.parentNode.removeChild(f);
            }
          });
        }
        for (let c = doc.body.firstChild; c; c = c.nextSibling) {
          ownerDoc.body.appendChild(ownerDoc.importNode(c, true));
        }
      }

      if (this.pageLimit && this.pageCount >= this.pageLimit) {
        throw new Error("done");
      }

      let savedQuery;
      if (this.attemptToIncrement) {
        console.log("attempting to increment query");
        let nq = this.incrementQuery();
        if (nq == this.query) {
          console.log("query did not increment");
          this.attemptToIncrement = false;
        }
        else {
          console.log("query did increment");
          savedQuery = this.query;
          this.query = nq;
        }
      }
      let node = doc.evaluate(this.query, doc, null, 9, null).singleNodeValue;
      let loc = src || null;
      if (this.attemptToIncrement && (!node || node.href == loc)) {
        console.log("no result after incrementing; restoring");
        console.log("inc:" + this.query + " orig:" + savedQuery);
        this.query = savedQuery;
        node = doc.evaluate(this.query, doc, null, 9, null).singleNodeValue;
        this.attemptToIncrement = false;
      }
      if (!node) {
        throw new Error("no next node found for query: " + this.query);
      }
      let nexturl = node.href.toString();
      if (loc && loc == nexturl) {
        throw new Error("location did not change for query" + this.query);
      }
      if (equalLinks(node,window.location)) {
        throw new Error("loop back to first item");
      }

      this.setTitle();
      console.info("next please: " + nexturl);
      createPageRequest(nexturl, this.allowScripts, frame => {
        if (this.slideshow && this.seconds) {
          console.info("slideshow; delay: " + this.seconds * 1000);
          this.loadNext(nexturl, frame, this.seconds * 1000);
        }
        else {
          console.info("regular; no-delay");
          this.loadNext(nexturl, frame, 0);
        }
      });
    }
    catch (ex) {
      console.log(ex);
      console.info("loadNext complete");
      this.unregister();
      this.restoreTitle();
    }
  }
};
Object.seal(Repaginator.prototype);

let Slideshow = function Slideshow(seconds, allowScripts, yielding) {
  this.seconds = seconds || 0;
  this.slideshow = true;
  this.allowScripts = allowScripts;
  this.yielding = yielding;
  this.init();
};
Slideshow.prototype = Repaginator.prototype;

let repaginate = (target, num, slideshow, allowScripts, yielding) => {
  try {
    let Ctor = slideshow ? Slideshow : Repaginator;
    let rep;
    focusElement = browser.menus.getTargetElement(target);
    rep = new Ctor(num, allowScripts, yielding);
    rep.buildQuery(focusElement);
    rep.repaginate();
  }
  catch (ex) {
    console.error("Failed to run repaginate", ex);
  }
};

let stop = () => {
  try {
    let body = document.body;
    if (body) {
      body.removeAttribute("repagination");
    }
  }
  catch (ex) {
    console.error("failed to stop repagination", ex);
  }
};

port.onMessage.addListener(msg => {
  switch (msg.msg) {
  case "normal": repaginate(msg.target, msg.num, msg.slideshow, msg.allowScripts, msg.yielding); break;
  case "stop" : stop(); break;
  }
});

// https://bugzilla.mozilla.org/show_bug.cgi?id=1370368
window.addEventListener('pagehide', function(event) {
  port.disconnect();
});

}  
/* vim: set et ts=2 sw=2 : */
