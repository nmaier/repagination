/* This Source Code Form is subject to the terms of the Mozilla Public
 *  * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 *   * You can obtain one at http://mozilla.org/MPL/2.0/. */
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

require("windows").registerOverlay(
  "repagination.xul",
  "chrome://browser/content/browser.xul",
  function main(window, document) {
    function $(id) document.getElementById(id);
    function $$(q) document.querySelector(q);
    function $$$(q) document.querySelectorAll(q);

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

    // XXX todo
    log(LOG_ERROR, "not implemented", new Error("mememe!"));
});
