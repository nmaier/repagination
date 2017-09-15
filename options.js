/* see also main.js */
var nullSettings = { exists: false };

/*
Update the options UI with the settings values retrieved from storage,
or the default settings if the stored settings are empty.
*/
function updateUI(restoredSettings) {
  document.querySelector("#loglevel").value = restoredSettings.loglevel;

  const checkboxes = document.querySelectorAll(".data-types [type=checkbox]");
  for (let item of checkboxes) {
    item.checked = !!restoredSettings[item.getAttribute("data-type")];
  }
  
  settings = restoredSettings;
}

function onError(e) {
  console.error(e);
}

browser.storage.local.get().then(updateUI, onError);

/* Save and restore */
function storeSettings() {
  settings.loglevel = document.querySelector("#loglevel").value;
  const checkboxes = document.querySelectorAll(".data-types [type=checkbox]");
  for (let item of checkboxes) {
    settings[item.getAttribute("data-type")] = item.checked;
  }
  browser.storage.local.set(settings);
}

function restoreSettings() {
  function logStorageChange(changes, area) {
    browser.storage.onChanged.removeListener(logStorageChange);
    browser.storage.local.get().then(updateUI, onError);
  }
  browser.storage.onChanged.addListener(logStorageChange);
  browser.storage.local.set(nullSettings);
}


const saveButton = document.querySelector("#save-button");
saveButton.addEventListener("click", storeSettings);

const restoreButton = document.querySelector("#restore-button");
restoreButton.addEventListener("click", restoreSettings);

