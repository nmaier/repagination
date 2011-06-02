/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Re-Pagination, based on Paste-and-Go.
 *
 * The Initial Developer of the Original Code is Nils Maier.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Jens Bannmann <jens.b@web.de>
 *   Oliver Aeberhard <aeberhard@gmx.ch>
 *   Nils Maier <maierman@web.de>
 *   Edward Lee <edilee@mozilla.com>
 *   Erik Vold <erikvvold@gmail.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

const PACKAGE = "repagination";
const LOCALES = ['en-US', 'de'];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const reportError = Cu.reportError;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyServiceGetter(
	this,
	"StringBundleService",
	"@mozilla.org/intl/stringbundle;1",
	"nsIStringBundleService");

// must receive the string bundle
let strings = null;

/**
 * Get a localized and/or formatted string
 *
 * @usage _('string')
 * @usage _('formated', param1, ...)
 * @param [String] id
 * @param [String] ...
 * @return [String] localized string
 */
function _() {
	if (arguments.length == 0) {
		return 0;
	}
	if (arguments.length == 1) {
		return strings.GetStringFromName(arguments[0]);
	}
	let args = Array.map(arguments, function(e) e);
	let id = args.shift();
	return strings.formatStringFromName(id, args, args.length);
};

/**
 * Localizes a node
 *
 * @usage __(node)
 * @param [DOMNode] node
 */
function __(node) {
	const attrs = ['label', 'tooltiptext'];
	function localize(node, attr) {
		try {
			let v = node.getAttribute(attr);
			if (!v) {
				return;
			}
			let m = v.match(/^(.+?)\((.+?)\)$/);
			if (!m) {
				v = _(v);
			}
			else {
				v = _.apply(null, [m[1]].concat(m[2].split(/,/g)));
			}
			node.setAttribute(attr, v);
		}
		catch (ex) {
			reportError(ex);
		}
	}
	attrs.forEach(function(a) localize(node, a));
};

function getFirstSnapshot(doc, node, query) doc
	.evaluate(query, node, null, 7, null)
	.snapshotItem(0);

function createFrame(window, src, loadFun) {
	let frame = window.document.createElement('iframe');
	frame.style.display = 'none';
	window.document.body.appendChild(frame);

	let docShell = frame.contentWindow.QueryInterface(Ci.nsIInterfaceRequestor)
		.getInterface(Ci.nsIWebNavigation)
		.QueryInterface(Ci.nsIDocShell);
	docShell.allowImages = false;
	docShell.allowPlugins = false;
	docShell.allowDNSPrefetch = false;

	frame.src = src;
	frame.addEventListener('load', function() {
		frame.removeEventListener('load', arguments.callee, false);
		loadFun.call(frame);
	}, false);
	let errorCount = 0;
	frame.addEventListener('error', function() {
		reportError("Failed to load: " + src);
		if (++errorCount > 5) {
			frame.removeEventListener('error', arguments.callee, false);
			loadFun.call(frame);
			return;
		}
		if (frame.history) {
			frame.history.reload();
			return;
		}
		frame.src = src;
	}, false);

	return frame;
}

if (!('setTimeout' in this)) {
	let Timer = Components.Constructor('@mozilla.org/timer;1', 'nsITimer', 'init');
	this.setTimeout = function(fun, timeout) new Timer({observe: function() fun()}, timeout, 0);
}

/**
 * Setup repagination for a window
 */
function main(window) {
	var document = window.document;

	function $(id) document.getElementById(id);
	function __r(node) __(node) + Array.forEach(node.getElementsByTagName("*"), __);

	function repaginate(num, slideshow) {
		let focusElement = document.commandDispatcher.focusedElement;
		let ctor = slideshow ? Slideshow : Repaginator;
		new ctor(focusElement, num).repaginate();
	}
	function repaginate_domain() {
		let focusElement = document.commandDispatcher.focusedElement;
		new DomainRepaginator(window, focusElement).repaginate();
	}
	function stop() {
		if (!window.gContextMenu || !window.gContextMenu.target) {
			let body = window.content.document.getElementsByTagName('body')[0];
			if (body) {
				body.removeAttribute('repagination');
			}
			return;
		}
		let body = window.gContextMenu.target.ownerDocument.getElementsByTagName('body')[0];
		if (body) {
			body.removeAttribute('repagination');
		}
	}

	function onContextMenu() {
		function setMenuHidden(hidden) {
			Array.forEach(
				menu.menupopup.childNodes,
				function(e) e.hidden = hidden
			);
			menu.hidden = hidden;
		}
		if (window.gContextMenu.onLink
			&& /^https?:/.test(document.commandDispatcher.focusedElement.href)) {
			setMenuHidden(false);
			try {
				if (!window.gContextMenu.target.ownerDocument.body
					.hasAttribute('repagination')) {
					// Not running, don't show stop
					stopMenu.hidden = true;
				}
			}
			catch (ex) {
				// no op
			}
			return;
		}
		setMenuHidden(true);
		try {
			if (window.gContextMenu.target.ownerDocument.body
				.hasAttribute('repagination')) {
				// show the menu so the user may abort
				menu.hidden = stopMenu.hidden = false;
			}
		}
		catch (ex) {
			// no op
		}
	}
	function onAll() repaginate();
	function onAllDomain() repaginate_domain();
	function onStop() stop();
	function onLimitCommand(event) {
		let t = event.target;
		if (t.localName != 'menuitem') {
			return;
		}
		repaginate(parseInt(t.getAttribute('value'), 10));
	}
	function onSlideCommand(event) {
		let t = event.target;
		if (t.localName != 'menuitem') {
			return;
		}
		repaginate(parseInt(t.getAttribute('value'), 10), true);
	}

	let menu = $('repagination_menu');
	__r(menu);
	let contextMenu = $('contentAreaContextMenu');
	let allMenu = $('repagination_flatten_nolimit');
	let allDomainMenu = $('repagination_flatten_nolimit_domain');
	let stopMenu = $('repagination_stop');
	let limitMenu = $('repagination_flat_limit_menu');
	let slideMenu = $('repagination_flat_nolimit_slide');

	contextMenu.addEventListener('popupshowing', onContextMenu, false);
	allMenu.addEventListener('command', onAll, true);
	allDomainMenu.addEventListener('command', onAllDomain, true);
	stopMenu.addEventListener('command', onStop, true);
	limitMenu.addEventListener('command', onLimitCommand, true);
	slideMenu.addEventListener('command', onSlideCommand, true);
	addWindowUnloader(window, function() {
		menu = null;
		contextMenu.removeEventListener('popupshowing', onContextMenu, false);
		contextMenu = null;
		allMenu.removeEventListener('command', onAll, true);
		allMenu = null;
		allDomainMenu.removeEventListener('command', onAllDomain, true);
		allDomainMenu = null;
		stopMenu.removeEventListener('command', onStop, true);
		stopMenu = null;
		limitMenu.removeEventListener('command', onLimitCommand, true);
		limitMenu = null;
		slideMenu.removeEventListener('command', onSlideCommand, true);
		slideMenu = null;
	});
}

/**
 * Repaginator implementation
 */
function Repaginator(focusElement, count) {
	this.pageLimit = count || 0;
	this.init(focusElement);
	this.buildQuery();
}
Repaginator.prototype = {
	slideshow: false,
	pageLimit: 0,
	seconds: 0,
	pageCount: 0,
	attemptToIncrement: true,

	init: function(focusElement) {
		// find the anchor
		(function findAnchor() {
			for (let parent = focusElement; parent; parent = parent.parentNode) {
				if (parent.localName == 'a') {
					focusElement = parent;
					return;
				}
			}

			throw new Error("No focus element");
		})();

		this._queryElement = focusElement;
		this._window = this._queryElement.ownerDocument.defaultView;
	},
	buildQuery: function() {
		this.query = "";

		var element = this._queryElement;

		// find an id in the ancestor chain, or alternatively a class
		// Note: cannot use id() xpath function here, as repagination might
		// create multiple ids
		(function findPathPrefix() {
			let pieces = [];
			for (let parent = element.parentNode; parent; parent = parent.parentNode) {
				if (parent.id) {
					pieces.unshift("//" + parent.localName + "[@id='" + parent.id +"']");
					break;
				}
				if (parent.className) {
					pieces.unshift("//" + parent.localName + "[@class='" + parent.className +"']");
				}
			}
			this.query = pieces.join("");
		}).call(this);

		// find the a-element to look up
		(function findExpression(){
			let range = element.ownerDocument.createRange();
			range.selectNode(element);
			let text = range.toString();

			// First, see if the anchor has a text we can use
			if (text.trim()) {
				this.query += "//a[.='" + text + "']";
				this.numberToken = /(a\[.='.*?)(\d+)(.*?'\])/;
				return;
			}

			// Second, see if it has a child with a @src we may use
			let srcElement = getFirstSnapshot(element.ownerDocument, element, 'child::*[@src]');
			if (srcElement) {
				let src = srcElement.getAttribute('src') || "";
				if (src.trim()) {
					this.query += "//" + srcElement.localName
						+ "[@src='" + src + "']/ancestor::a";
					this.numberToken = /(\[@src='.*?)(\d+)(.*?'\])/;
					return;
				}
			}

			// Third, see if there is a child with a @value we may use
			let valElement = getFirstSnapshot(element.ownerDocument, element, 'child::*[@value]');
			if (valElement) {
				let val = valElement.getAttribute('value') || "";
				if (val.trim()) {
					this.query += "//" + valElement.localName
						+ "[@value='" + val + "']/ancestor::a";
					this.numberToken = /(\[@value='.*?)(\d+)(.*?'\])/;
					return;
				}
			}

			// Nothing else we might try
			throw new Error("Repagination: no anchor expression found!");
		}).call(this);

		// we want the last
		this.query = "(" + this.query + ")[last()]";

		//reportError(this.query);
	},


	setTitle: function() {
		if(!this._title) {
			this._title = this._window.document.title;
		}
		if (this.pageLimit) {
			this._window.document.title = _('repagination_limited',
				this.pageCount,
				this.pageLimit);
		}
		else if (this.pageCount > 0) {
			this._window.document.title = _('repagination_unlimited',
				this.pageCount);
		}
		else {
			this._window.document.title = _('repagination_running');
		}
	},
	restoreTitle: function() {
		if (this._title) {
			this._window.document.title = this._title;
			delete this._title;
		}
	},

	repaginate: function() {
		this.setTitle();

		try {
			let node = this._window.document.evaluate(
				this.query,
				this._window.document,
				null,
				9,
				null
				).singleNodeValue;

			if (!node) {
				throw new Error("No node");
			}

			let self = this;
			let frame = createFrame(this._window, node.href, function(event) {
				self.loadNext(this);
			});
			this._window.document.body.setAttribute('repagination', 'true');
		}
		catch (ex) {
			this.restoreTitle();
			this._window.document.body.removeAttribute('repagination');
			reportError(ex);
		}
	},

	incrementQuery: function() this.query.replace(
			this.numberToken,
			function(g, pre, num, post) pre + (parseInt(num, 10) + 1) + post
			),

	loadNext: function(element) {
		let ownerDoc = element.ownerDocument;
		if (!ownerDoc) {
			setTimeout(function() element.parentNode.removeChild(element), 0);
			this.restoreTitle();
			return;
		}
		try {
			if (!ownerDoc.body.hasAttribute('repagination'))	{
				throw new Error("Not running");
			}

			var doc = element.contentDocument;
			this.pageCount++;

			// remove futher scripts
			// Note: this is not a security mechanism, but a performance
			// optimization, as the scripts will likely not execute properly
			// anyway and may even introduce new errors to the page
			Array.forEach(
				doc.querySelectorAll('script'),
				function(s) s.parentNode.removeChild(s)
			);

			// Remove non-same-origin iframes
			// Otherwise we might create a shitload of (nearly) identical frames
			// and (almost) kill the browser
			if (!this.pageLimit || this.pageLimit > 20) {
				let host = ownerDoc.defaultView.location.hostname;
				Array.forEach(
						doc.querySelectorAll('iframe'),
						function(f) {
							if (f.contentWindow.location.hostname != host) {
								f.parentNode.removeChild(f)
							}
						}
				);
			}

			if (this.slideshow) {
				ownerDoc.body.innerHTML = doc.body.innerHTML;
				ownerDoc.body.setAttribute('repagination', 'true');
			}
			else {
				Array.forEach(
					doc.body.children,
					function(c) ownerDoc.body.appendChild(ownerDoc.importNode(c, true))
				);
			}
			if (ownerDoc.defaultView) {
				let levt = ownerDoc.createEvent("Events");
				levt.initEvent("DOMContentLoaded", true, true);
				ownerDoc.defaultView.dispatchEvent(levt);
				levt = ownerDoc.createEvent("Events");
				levt.initEvent("load", true, true);
				ownerDoc.defaultView.dispatchEvent(levt);
			}
			var savedQuery;
			if (this.attemptToIncrement) {
				let newQuery = this.incrementQuery();
				if (newQuery == this.query) {
					this.attemptToIncrement = false;
				}
				else {
					savedQuery = this.query;
					this.query = newQuery;
				}
			}

			node = doc.evaluate(
				this.query,
				doc,
				null,
				9,
				null
				).singleNodeValue;

			let location = (doc.location || {}).href || null;

			if (this.attemptToIncrement
				&& (!node || node.href == location)) {
				this.query = savedQuery;

				node = doc.evaluate(
					this.query,
					doc,
					null,
					9,
					null
					).singleNodeValue;
				this.attemptToIncrement = false;
			}

			if (!node) {
				throw new Error("No next node found");
			}
			if (location && location == node.href) {
				throw new Error("Location match (nothing new): " + location + ", " + node.href);
			}

			if (this.pageLimit && this.pageCount >= this.pageLimit) {
				throw new Error("Done");
			}

			this.setTitle();

			let self = this;
			let frame = createFrame(this._window, node.href, function() {
				if (self.slideshow) {
					setTimeout(function() self.loadNext(frame), self.seconds * 1000);
				}
				else {
					self.loadNext(this);
				}
			});
		}
		catch (ex) {
			this.restoreTitle();
			ownerDoc.body.removeAttribute('repagination');
		}

		// kill the frame again
		if (element && element.parentNode) {
			setTimeout(function() element.parentNode.removeChild(element), 0);
		}
	}
};

function DomainRepaginator(window, focusElement) {
	this.init(focusElement);
	this.buildQuery();

	this._internalPaginators = [];
	let host = this._window.location.hostname;
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
			reportError(ex);
		}
	}
}
DomainRepaginator.prototype = {
	__proto__: Repaginator.prototype,
	repaginate: function() {
		for each (let ip in this._internalPaginators) {
			ip.repaginate();
		}
	}
}
DomainRepaginator.InternalRepaginator = function(focusElement, query) {
	this.init(focusElement);
	this.query = query;
};
DomainRepaginator.InternalRepaginator.prototype = {
	__proto__: Repaginator.prototype
};

function Slideshow(focusElement, seconds) {
	this.seconds = seconds || 0;
	this.slideshow = true;
	this.init(focusElement);
	this.buildQuery();
}
Slideshow.prototype = {
	__proto__: Repaginator.prototype
};

function addWindowUnloader(window, fn) {
	let handler = addUnloader(function() {
		window.removeEventListener('unload', handler, false);
		try {
			fn();
		}
		catch (ex) {
			reportError(ex);
		}
	});
	window.addEventListener('unload', handler, false);
}

/* ***
 bootstrap specific
 * ***/
const {
	install: install,
	uninstall: uninstall,
	startup: startup,
	shutdown: shutdown,
	addUnloader: addUnloader
} = (function(self) {
	Cu.import("resource://gre/modules/AddonManager.jsm");
	Cu.import("resource://gre/modules/Services.jsm");

	if (!('XMLHttpRequest' in this)) {
		this.XMLHttpRequest = Components.Constructor("@mozilla.org/xmlextras/xmlhttprequest;1", "nsIXMLHttpRequest");
	}

	/**
	 * Apply a callback to each open and new browser windows.
	 *
	 * @usage watchWindows(callback): Apply a callback to each browser window.
	 * @param [function] callback: 1-parameter function that gets a browser window.
	 */
	function watchWindows(callback) {
		// Wrap the callback in a function that ignores failures
		function watcher(window) {
			try {
				callback(window);
			}
			catch(ex) {}
		}

		// Wait for the window to finish loading before running the callback
		function runOnLoad(window) {
			// Listen for one load event before checking the window type
			window.addEventListener("load", function() {
				window.removeEventListener("load", arguments.callee, false);

				// Now that the window has loaded, only handle browser windows
				let doc = window.document.documentElement;
				if (doc.getAttribute("windowtype") == "navigator:browser")
					watcher(window);
			}, false);
		}

		// Add functionality to existing windows
		let browserWindows = Services.wm.getEnumerator("navigator:browser");
		while (browserWindows.hasMoreElements()) {
			// Only run the watcher immediately if the browser is completely loaded
			let browserWindow = browserWindows.getNext();
			if (browserWindow.document.readyState == "complete")
				watcher(browserWindow);
			// Wait for the window to load before continuing
			else
				runOnLoad(browserWindow);
		}

		// Watch for new browser windows opening then wait for it to load
		function windowWatcher(subject, topic) {
			if (topic == "domwindowopened")
				runOnLoad(subject);
		}
		Services.ww.registerNotification(windowWatcher);

		// Make sure to stop watching for windows if we're unloading
		addUnloader(function() Services.ww.unregisterNotification(windowWatcher));
	}

	/**
	 * Setup a window according to some XUL and call the next in chain.
	 * Aka. poor man's loadOverlay
	 *
	 * @author Nils Maier
	 * @param [object] xul: object-dict containing the target-id/Element
	 * @param [function] next: next function to run
	 * @param [window] window to set up
	 */
	function setupWindow(xul, next, window) {
		try {
			if (!xul) {
				reportError("No XUL for some reason");
				return;
			}
			// shortcut
			let document = window.document;

			// Santa's little helpers
			function $(id) document.getElementById(id);
			function $$(q) document.querySelector(q);

			// loadOverlay for the poor
			function addNode(target, node) {
				// bring the node to be inserted into the document
				let nn = document.importNode(node, true);

				// helper: insert according to position
				function insertX(attr, callback) {
					if (!nn.hasAttribute(attr)) {
						return false;
					}
					let places = nn.getAttribute(attr)
						.split(',')
						.map(function(p) p.trim())
						.filter(function(p) !!p);
					for each (let p in places) {
						let pn = $$('#' + target.id + ' > #' + p);
						if (!pn) {
							continue;
						}
						callback(pn);
						return true;
					}
					return false;
				}

				// try to insert according to insertafter/before
				if (insertX('insertafter', function(pn) pn.parentNode.insertBefore(nn, pn.nextSibling))
					|| insertX('insertbefore', function(pn) pn.parentNode.insertBefore(nn, pn))) {
					return nn;
				}
				// just append
				target.appendChild(nn);
				return nn;
			}

			// store unloaders for all elements inserted
			let unloaders = [];

			// Add all overlays
			for (let id in xul) {
				let target = $(id);
				if (!target) {
					reportError("no target for " + id + ", not inserting");
					continue;
				}

				// insert all children
				for (let n = xul[id].firstChild; n; n = n.nextSibling) {
					if (n.nodeType != n.ELEMENT_NODE) {
						continue;
					}
					let nn = addNode(target, n);
					unloaders.push(function() nn.parentNode.removeChild(nn));
				}
			}

			// install per-window unloader
			if (unloaders.length) {
				addWindowUnloader(window, function() unloaders.forEach(function(u) u()));
			}

			// run next
			next && next(window);
		}
		catch (ex) {
			reportError(ex);
		}
	}

	/**
	 * Loads some XUL and pushes it to watchWindows(setupWindow(next))
	 *
	 * @author Nils Maier
	 * @param [string] file: XUL file to load
	 * @param [function] next: function to call from watchWindows
	 * @param [Addon] addon: AddonManger info about the addon to load the XUL from
	 */
	function loadXUL(file, next, addon) {
		try {
			let xulUrl = addon.getResourceURI(file).spec;
			let xulReq = new XMLHttpRequest();
			xulReq.onload = function() {
				let document = xulReq.responseXML;
				let root = document.documentElement;

				function xpath() {
					let rv = [];
					for (let i = 0; i < arguments.length; ++i) {
						let nodeSet = document.evaluate(arguments[i], document, null, 7, null);
						for (let j = 0; j < nodeSet.snapshotLength; ++j) {
							rv.push(nodeSet.snapshotItem(j));
						}
					}
					return rv;
				}
				// clean empty textnodes
				xpath("//text()[normalize-space(.) = '']")
					.forEach(function(n) n.parentNode.removeChild(n));

				let xul = {};
				for (let i = root.firstChild; i; i = i.nextSibling) {
					if (i.nodeType != i.ELEMENT_NODE || !i.hasAttribute('id')) {
						continue;
					}
					let id = i.getAttribute('id');
					xul[id] = i;
				}
				watchWindows(setupWindow.bind(null, xul, next));
			};
			xulReq.overrideMimeType('application/xml');
			xulReq.open('GET', xulUrl);
			xulReq.send();
		}
		catch (ex) {
			reportError(ex);
		}
	}

	/**
	 * Loads the string bundle for PACKAGE according to user locale
	 * and chrome.manifest. The bundle is assigned to global.strings
	 *
	 * @author Nils Maier
	 * @param [Addon] addon: Addon data from AddonManager
	 * @param [function] next: Next function to call
	 */
	function initStringBundle(addon) {
		// get selected locale
		let xr = Cc["@mozilla.org/chrome/chrome-registry;1"].getService(Ci.nsIXULChromeRegistry);
		let locale = xr.getSelectedLocale('global');

		// exact match?
		let idx = LOCALES.indexOf(locale);
		if (idx < 0) {
			// best match?
			idx = LOCALES.map(function(l) l.split("-")[0]).indexOf(locale.split("-")[0]);
		}

		// load the string bundle
		let sb = addon.getResourceURI(
			'locale/'
			+ LOCALES[Math.max(0, idx)]
			+ '/' + PACKAGE + '.properties').spec;
		strings = StringBundleService.createBundle(sb);
	}


	/**
	 * Add an unloader
	 *
	 * @author Nils Maier
	 * @param [function] callback: unload function to be called
	 * @return [function] unloader: Can be called at any time to run and remove the unloader
	 */
	function addUnloader(callback) {
		shutdown.unloaders.push(callback);
		return function() {
			try {
				callback();
			}
			catch (ex) {}
			shutdown.unloaders = shutdown.unloaders.filter(function(c) c != callback);
		};
	}

	// Addon manager post-install entry
	function install() {
		StringBundleService.flushBundles();
	}

	// Addon manager pre-uninstall entry
	function uninstall(){}

	// Addon manager shutdown entry
	function shutdown(data, reason) {
		if (reason === APP_SHUTDOWN) {
			// No need to cleanup; stuff will vanish anyway
			return;
		}
		for (let u = shutdown.unloaders.pop(); u; u = shutdown.unloaders.pop()) {
			try {
				u();
			}
			catch (ex) {
				reportError("Unloader threw" + u.toSource());
			}
		}
	}
	shutdown.unloaders = [];

	const importModule = (function() {
		const scriptLoader = Cc["@mozilla.org/moz/jssubscript-loader;1"]
			.getService(Ci.mozIJSSubScriptLoader);
		return function importModule(uri) {
			let ctx = {};
			scriptLoader.loadSubScript(uri.spec, ctx);
			for each (let sym in ctx.EXPORTED_SYMBOLS) {
				self[sym] = ctx[sym];
			}
		};
	})();

	// Addon manager startup entry
	function startup(data) AddonManager.getAddonByID(
		data.id,
		function(addon) {
			initStringBundle(addon);
			loadXUL(PACKAGE + ".xul", main, addon);
		}
	);

	return {
		install: install,
		uninstall: uninstall,
		startup: startup,
		shutdown: shutdown,
		addUnloader: addUnloader
		};
})(this);

/* vim: set noet ts=2 sw=2 : */
