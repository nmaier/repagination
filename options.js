/* see also main.js */

/*
Update the options UI with the settings values retrieved from storage,
or the default settings if the stored settings are empty.
*/
function updateUI(restoredSettings) {
  document.getElementById("slideshows").checked = restoredSettings.slideshows || false;
}

function onError(e) {
  console.error(e);
}

browser.storage.local.get().then(updateUI, onError);

document.getElementById("slideshows").onchange = function setSlideshows() {
  browser.storage.local.set({ exists: true, slideshows: document.getElementById("slideshows").checked});
};
