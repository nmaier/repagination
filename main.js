/* This Source Code Form is subject to the terms of the Mozilla Public
 *  * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 *   * You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

require("windows").registerOverlay(
  "repagination.xul",
  "chrome://browser/content/browser.xul",
  function main(window, document) {
    log(LOG_INFO, "main called!");
    // XXX todo
    log(LOG_ERROR, "not implemented", new Error("mememe!"));
});
