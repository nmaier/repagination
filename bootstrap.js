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

const EXPORTED_SYMBOLS = ['repagination'];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const reportError = Cu.reportError;

const regxNumber = /[0-9]+/;
const regx2Numbers = /[0-9]+[^0-9][0-9]+/;

function getFirstSnapshot(doc,node,query) doc
	.evaluate(query, node, null, 7, null)
	.snapshotItem(0);

if (!('setTimeout' in this)) {
	let Timer = Components.Constructor('@mozilla.org/timer;1', 'nsITimer', 'init');
	this.setTimeout = function(fun, timeout) new Timer({observe: function() fun()}, timeout, 0);
}

/**
 * Setup repagination for a window
 */
function repagination(window) {
	var document = window.document;

	function $(id) document.getElementById(id);

	function blast(num, isslide) {
		var focusElement = document.commandDispatcher.focusedElement;
		if (!focusElement) {
			throw new Error("No focus element");
		}
		var doc = focusElement.ownerDocument;
		var repaginator = new Repaginator();

		if (isslide && num) {
			repaginator.seconds = num;
			repaginator.slideshow = true;
			repaginator.nolimit = true;
		}
		else if (num) {
			repaginator.slideshow = false;
			repaginator.pagelimit = num;
			repaginator.nolimit = false;
		}
		else {
			repaginator.slideshow = false;
			repaginator.nolimit = true;
		}
		var searchpathtext = '';
		var range = doc.createRange();
		range.selectNode(focusElement);
		searchpathtext = range.toString();

		repaginator.query = '//body';
		if (searchpathtext) {
			repaginator.query = '//a[.=\''+searchpathtext+'\'][position()=last()]';
		}
		else if (focusElement.getAttribute('value'))	{
			var input_value = focusElement.getAttribute('value');

			if (input_value) {
				repaginator.query = '//input[@value=\''+input_value+'\'][position()=last()]/ancestor::a';
			}
		}
		else if (focusElement.getAttribute('src')) {
			var img_src = focusElement.getAttribute('src');

			if (img_src)	{
				repaginator.query = '//img[@src=\''+img_src+'\'][position()=last()]/ancestor::a';
			}
		}
		else if (focusElement instanceof window.HTMLAnchorElement) {
			var srcObj = getFirstSnapshot(doc, focusElement, 'child::*[@src]');
			if (srcObj) {
				var img_src = srcObj.getAttribute('src');
				if (img_src) {
					repaginator.query = '//img[@src=\''+img_src+'\'][position()=last()]/ancestor::a';
				}
			}
		}
		repaginator.query += "[last()]";

		repaginator.numberToIncrement = null;
		repaginator.attemptToIncrement = false;

		if (!regx2Numbers.test(repaginator.query)) {
			var test = regxNumber.exec(repaginator.query);
			if (test) {
				repaginator.attemptToIncrement = true;
				repaginator.numberToIncrement = test[0];
			}
		}

		repaginator.blast(doc.defaultView);
	}
	function stop() {
		if (!window.gContextMenu || !window.gContextMenu.target) {
			let body = window.content.document.getElementsByTagName('body')[0];
			if (body) {
				body.setAttribute('repagination','isOff');
			}
			return;
		}
		let body = window.gContextMenu.target.ownerDocument.getElementsByTagName('body')[0];
		if (body) {
			body.setAttribute('repagination','isOff');
		}
	}
	let menu = $('repagination_menu');
	let contextMenu = $('contentAreaContextMenu');
	contextMenu.addEventListener('popupshowing', function() {
		if (window.gContextMenu.onLink) {
			menu.hidden = false;
			return;
		}

		var doc = window.gContextMenu.target.ownerDocument;
		var body = doc.getElementsByTagName('body')[0];
		if (!body) {
			menu.hidden = true;
			return;
		}

		var result = body.getAttribute('repagination');
		if (!result) {
			menu.hidden = true;
			return;
		}
		if(result == 'isOn') {
			menu.hidden = false;
			return;
		}
		menu.hidden = true;
	}, true);

	// All
	$('repagination_flatten_nolimit').addEventListener('command', function(event) {
		blast();
	}, true);
	// Stop
	$('repagination_stop').addEventListener('command', function(event) {
		stop();
	}, true);
	// Limit
	$('repagination_flat_limit_menu').addEventListener('command', function(event) {
		let t = event.target;
		if (t.localName != 'menuitem') {
			return;
		}
		blast(parseInt(t.getAttribute('label'), 10));
	}, true);
	// Slideshow
	$('repagination_flat_nolimit_slide').addEventListener('command', function(event) {
		let t = event.target;
		if (t.localName != 'menuitem') {
			return;
		}
		blast(parseInt(t.getAttribute('value'), 10), true);
	}, true);
}

/**
 * Repaginator implementation
 */
function Repaginator() {}
Repaginator.prototype = {
	enabled: false,
	pagecounter: 0,
	beforeNum: '',
	afterNum: '',
	numStr: '',
	isSelect: true,

	setTitle: function() {
		this._title = this._window.document.title;
		this._window.document.title = "Re-Pagination running...";
	},
	restoreTitle: function() {
		if (this._title) {
			this._window.document.title = this._title;
			delete this._title;
		}
	},

	blast: function(win) {
		this._window = win;
		this.setTitle();

		try {
			let node = win.document.evaluate(
				this.query,
				win.document,
				null,
				9,
				null
				).singleNodeValue;

			if (!node) {
				throw new Error("No node");
			}

			win.document.body.setAttribute('repagination','isOn');

			let frame = win.document.createElement('iframe');
			frame.style.display = 'none';
			frame.setAttribute('src',node.href);

			let self = this;
			frame.addEventListener('load', function(event) {
				this.removeEventListener('load', arguments.callee, true);
				self.loadNext(this);
			}, true);
			win.document.body.setAttribute('repagination','isOn');
			win.document.body.appendChild(frame);
		}
		catch (ex) {
			this.restoreTitle();
			win.document.body.setAttribute('repagination','isOff');
			reportError(ex);
		}
	},

	increment: function() {
		this.query = this.query.replace(
			new RegExp(this.numberToIncrement, 'g'),
			new Number(this.numberToIncrement) + 1
			);
		this.numberToIncrement++;
	},

	loadNext: function(element) {
		let ownerDoc = element.ownerDocument;
		if (!ownerDoc) {
			setTimeout(function() element.parentNode.removeChild(element), 0);
			this.restoreTitle();
			return;
		}
		try {
			if (ownerDoc.body.getAttribute('repagination') != 'isOn')	{
				throw new Error("Not running");
			}

			var doc = element.contentDocument;
			this.pagecounter++;

			if (this.slideshow) {
				ownerDoc.body.innerHTML = doc.body.innerHTML;
				ownerDoc.body.setAttribute('repagination', 'isOn');
			}
			else {
				ownerDoc.body.innerHTML += doc.body.innerHTML;
			}

			var savedQuery;
			if (this.attemptToIncrement) {
				savedQuery = this.query;
				this.increment();
			}
			else if (this.numberToIncrement) {
				this.increment();
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
				this.numberToIncrement = null;

				node = doc.evaluate(
					this.query,
					doc,
					null,
					9,
					null
					).singleNodeValue;
			}

			this.attemptToIncrement = false;

			if (!node) {
				throw new Error("No next node found");
			}
			if (location && location == node.href) {
				throw new Error("Location match (nothing new): " + location + ", " + node.href);
			}

			if (!this.nolimit && this.pagecounter >= this.pagelimit) {
				throw new Error("Done");
			}

			let frame = ownerDoc.createElement('iframe');
			frame.style.display = 'none';
			frame.setAttribute('src', node.href);

			let self = this;
			frame.addEventListener('load',function() {
				this.removeEventListener('load', arguments.callee, true);
				if (self.slideshow) {
					setTimeout(function() self.loadNext(niframe), self.seconds * 1000);
				}
				else {
					self.loadNext(this);
				}
			}, true);

			ownerDoc.body.appendChild(frame);
		}
		catch (ex) {
			this.restoreTitle();
			ownerDoc.body.setAttribute('repagination','isOff');
		}

		// kill the frame again
		setTimeout(function() element.parentNode.removeChild(element), 0);
	}
};

/* ***
 bootstrap specific
 * ***/
const {install: install, uninstall: uninstall, startup: startup, shutdown: shutdown} = (function() {
	try {
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
					let nn = document.adoptNode(node.cloneNode(true));

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
					let handler = addUnloader(function() {
						window.removeEventListener('unload', handler, false);
						unloaders.forEach(function(u) u());
					});
					window.addEventListener('unload', handler, false);
				}

				// run next
				next(window);
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
		function install(){}

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

		// Addon manager startup entry
		function startup(data) AddonManager.getAddonByID(data.id, loadXUL.bind(null, "repagination.xul", repagination));

		return {install: install, uninstall: uninstall, startup: startup, shutdown: shutdown};
	}
	catch (ex) {
		// pre-moz2
		return {install: null, uninstall: null, startup: null, shutdown: null};
	}
})();