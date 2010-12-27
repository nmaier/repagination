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
 * The Original Code is Paste and Go.
 *
 * The Initial Developer of the Original Code is Jens Bannmann.
 * Portions created by the Initial Developer are Copyright (C) 2003
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s) (alphabetical order):
 *  Jens Bannmann <jens.b@web.de>
 *  Oliver Aeberhard <aeberhard@gmx.ch>
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

const antipagination = 
{	
	regxNumber : /[0-9]+/,
	regx2Numbers : /[0-9]+[^0-9][0-9]+/,
	getContents : function(aURL) {
		var ioService=Components.classes["@mozilla.org/network/io-service;1"]
			.getService(Components.interfaces.nsIIOService);
		var scriptableStream=Components
			.classes["@mozilla.org/scriptableinputstream;1"]
			.getService(Components.interfaces.nsIScriptableInputStream);
		var channel=ioService.newChannel(aURL,null,null);
		var input=channel.open();
		scriptableStream.init(input);
		var str=scriptableStream.read(input.available());
		scriptableStream.close();
		input.close();
		return str;
	},
	blast : function(num,isslide) {	
		var focusElement = document.commandDispatcher.focusedElement;
		if(focusElement == null) {
			return;
		}
		var doc = focusElement.ownerDocument;
		/* inject script */
		
		var repaginator = new Repaginator();

		if(isslide != null && num != null) {
			repaginator.seconds = num;
			repaginator.slideshow = true;
			repaginator.nolimit = true;
		}
		else if(num != null) {
			repaginator.slideshow = false;
			repaginator.pagelimit = num;
			repaginator.nolimit = false;
		}
		else {
			repaginator.slideshow = false;
			repaginator.nolimit = true;
		}
		var searchpathtext = '';
		var range = focusElement.ownerDocument.createRange();
		range.selectNode(focusElement);
		searchpathtext = range.toString();
		var query = '//body';
		if(searchpathtext != null && searchpathtext != '') {
			query = '//a[.=\''+searchpathtext+'\'][position()=last()]';
		}
		else {
			if(focusElement.getAttribute('value') != '' && 
				focusElement.getAttribute('value') != null)	{
				var input_value = focusElement.getAttribute('value');

				if(input_value != '') {
					query = '//input[@value=\''+input_value+'\'][position()=last()]/ancestor::a';
				}
			}
			else if(focusElement.getAttribute('src') != '' && 
			focusElement.getAttribute('src') != null) {
				
				var img_src = focusElement.getAttribute('src');

				if(img_src != '')	{
					query = '//img[@src=\''+img_src+'\'][position()=last()]/ancestor::a';
					
				}
			}
			else if(focusElement instanceof HTMLAnchorElement) {
				/* get src */
				var srcObj = antipagination.returnFirstSnapshot(doc, focusElement, 'child::*[@src]');
				if(srcObj != null) {
					var img_src = srcObj.getAttribute('src');
	
					if(img_src != '')
					{
						query = '//img[@src=\''+img_src+'\'][position()=last()]/ancestor::a';
					}
				}	
			}
		}

		repaginator.query=query;
		repaginator.numberToIncrement = null;
		repaginator.attemptToIncrement = false;
		
		if (!this.regx2Numbers.test(query))	{
			var test = this.regxNumber.exec(query);
			if (test)	{
				repaginator.attemptToIncrement = true;
				repaginator.numberToIncrement = test[0];
			}
		}

		repaginator.blast(doc.defaultView);
	},

	// Register each repaginator. It is unregistered as soon as it is gotten (by its iframe).
	repaginators : new Array(),
	RegisterRepaginator : function (apg) {
		this.repaginators.push(apg);
	},
	GetRepaginator : function (iframe) {
		for (var i = 0; i < this.repaginators.length; i++)
			if (this.repaginators[i].iframe == iframe)
			{
				var found = this.repaginators[i];
				this.repaginators[i] = this.repaginators[this.repaginators.length - 1];
				this.repaginators.pop();
				return found;
			}
		return null;
	},
	returnFirstSnapshot : function (doc,node,query) {
		return doc
			.evaluate(query,node,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null)
				.snapshotItem(0);
	},

	stop : function() {
		if(gContextMenu == null
		|| gContextMenu.target == null)
		{			
			var body = window._content.document.getElementsByTagName('body')[0];
		
			if(body != null)
			{
				body.setAttribute('antipagination','isOff');
			}
		}
		else
		{
			var doc = gContextMenu.target.ownerDocument;
			var body = doc.getElementsByTagName('body')[0];
		
			if(body != null)
			{
				body.setAttribute('antipagination','isOff');
			}
		}
	},
	onload : function() {
		antipagination.menu = document
			.getElementById('antipagination_menu');
		var contextMenu = document
			.getElementById('contentAreaContextMenu');
		contextMenu.addEventListener('popupshowing', 
			antipagination.popupshowing, true);
		var urlbar = document
			.getElementById('urlbar');
		//urlbar.addEventListener('popupshowing', 
		//	antipagination.urlcontextshowing, true);
	},
	urlcontextshowing : function(event) {
		var urlbar = document
			.getElementById('urlbar');
		urlbar.removeEventListener('popupshowing', 
			antipagination.urlcontextshowing, true);
		/**/
		var copyNode = document.getElementById('antipagination_menu2');
		event.originalTarget.appendChild(copyNode);
	},
	popupshowing : function()	{
		if(gContextMenu.onLink == true)
		{
			antipagination.menu.hidden = false;
			return;
		}
		
		var doc = gContextMenu.target.ownerDocument;
		var body = doc.getElementsByTagName('body')[0];
		
		if(body == null)
		{

			antipagination.menu.hidden = true;
			return;
		}
		else
		{
			var result = body.getAttribute('antipagination');
			if(result == '')
			{

				antipagination.menu.hidden = true;
				return;
			}
			else if(result == 'isOn')
			{

				antipagination.menu.hidden = false;
				return;
			}
			else
			{

				antipagination.menu.hidden = true;
				return;
			}
		}
	}
};
window.addEventListener('load',antipagination.onload,true);
function Repaginator() {}

Repaginator.prototype.enabled = false;
Repaginator.prototype.pagecounter = 0;
Repaginator.prototype.prevPage = '';

// Get last item in a container
Repaginator.prototype.getLast = function(container) {
	var item =  container.iterateNext();
	var temp = item;
	while(temp != null)
	{
		temp = container.iterateNext();
		if(temp != null)
		{
			item = temp;
		}
	}
	return item;
};

Repaginator.prototype.blast = function(win) {	
	try	{
		var xresult = win.document
				.evaluate(
					this.query,
					win.document,null,0,null);
		var node = this.getLast(xresult);
		if(node != null) {
			win.document.body.setAttribute('antipagination','isOn');

			var iframe = win.document.createElement('iframe');
			this.iframe = iframe;
			iframe.style.display='none';
			iframe.setAttribute('src',node.href);
			antipagination.RegisterRepaginator(this);
			iframe.addEventListener('load',function(event)
			{					
				antipagination.GetRepaginator(this).loadNext(this);
			},true);
			win.document.body.setAttribute('antipagination','isOn');
			win.document.body.appendChild(iframe);
		}
		else {
			win.document.body.setAttribute('antipagination','isOff');
		}
	}
	catch(ex) {
		win.document.body.setAttribute('antipagination','isOff');
	}
};
Repaginator.prototype.beforeNum =	Repaginator.prototype.afterNum =
Repaginator.prototype.numStr = '';
Repaginator.prototype.isSelect = true;

Repaginator.prototype.loadNextThunk = function() {
	myRepaginator.loadNext(myRepaginator.iframe);
};

Repaginator.prototype.increment = function() {
	this.query = this.query.replace(new RegExp(this.numberToIncrement, 'g'), Number(this.numberToIncrement) + 1);
	this.numberToIncrement++;
};

/// Append all children of source to target
Repaginator.prototype.AppendChildren = function(source, target) {
	//alert(source);
	//alert(source.firstChild);
	for (var child = source.firstChild; child != null; child = child.nextSibling)	{
		//alert(child);
		target.appendChild(child.cloneNode(true));
	}
};

Repaginator.prototype.loadNext = function(element) {
	if (this.prevIframe)
		this.prevIframe.parentNode.removeChild(this.prevIframe);
	if (!this.slideshow) 
		this.prevIframe = this.iframe;

	if(element.ownerDocument.body.getAttribute('antipagination') == 'isOn')	{
		var doc = this.iframe.contentDocument;
		this.pagecounter++;
		if(this.slideshow) {
			element.ownerDocument.body.style.display = 'none';
			var cloner = doc.body.cloneNode(true);
			element.ownerDocument.documentElement.appendChild(cloner);
			element.ownerDocument.body = cloner;
			element.ownerDocument.body.setAttribute('antipagination','isOn');
		}
		else {
			this.AppendChildren(doc.body, element.ownerDocument.body);
			//element.ownerDocument.body.appendChild(doc.body.cloneNode(true));
		}

		var savedQuery;
		if (this.attemptToIncrement) {
			savedQuery = this.query;
			this.increment();
		}
		else if (this.numberToIncrement != null)
			this.increment();

		var xresult = doc
			.evaluate(this.query,doc,null,0,null);

		var node = this.getLast(xresult);

		if (this.attemptToIncrement && (node == null || node.href == doc.location.href)) {
			this.query = savedQuery;
			this.numberToIncrement = null;

			var xresult = doc
				.evaluate(this.query,doc,null,0,null);
			node = this.getLast(xresult);
		}

		this.attemptToIncrement = false;

		if(node != null && (doc.location == null || node.href != doc.location.href)) {

			if(doc.location != null) {
				this.prevPage = 
					doc.location.href;
			}
			if(
				(
				(this.nolimit == false) 
				&& (this.pagecounter <
				this.pagelimit)
				 ) 
				|| this.nolimit == true
			) {
				var niframe = element.ownerDocument.createElement('iframe');
				this.iframe = niframe;
				niframe.style.display='none';
				niframe.setAttribute('src',node.href);
				antipagination.RegisterRepaginator(this);
				niframe.addEventListener('load',function() {
					var repaginator = antipagination.GetRepaginator(this);
					if(repaginator.slideshow)
					{
						myRepaginator = repaginator;
						var timeout = setTimeout(repaginator.loadNextThunk, repaginator.seconds*1000);
					}
					else
					{
						repaginator.loadNext(this);
					}
				},true);
				element.ownerDocument.body.appendChild(niframe);
			}
			else {
				element.ownerDocument.body.setAttribute('antipagination','isOff');
			}
		}
		else {
			element.ownerDocument.body.setAttribute('antipagination','isOff');
		}
	}
};
