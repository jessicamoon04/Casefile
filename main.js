"use strict";

// Start-up: restore what this browser remembers, wire up the shell, then load disputes.
state.briefs = Store.briefs();
state.overrides = Store.overrides();

// The access code screen can't be dismissed: without a code nothing loads.
$("access-dialog").addEventListener("cancel", (e) => e.preventDefault());

Notify.init();
Views.init();
showSavedInbox();
loadInbox();
