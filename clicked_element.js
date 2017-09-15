// https://bugzilla.mozilla.org/show_bug.cgi?id=1325814
var clickedEl = null;

document.addEventListener("contextmenu", function(event) {
	clickedEl = event.target;
}, true);
