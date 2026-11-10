// "Open Casefile" asks for the access code here, before the app loads.
// The code is checked by the server (/api/access) and kept for this tab only (sessionStorage),
// under the same name the app uses, so the app does not ask again.
// Without JavaScript the links still work and the app asks for the code itself.
(function () {
  "use strict";
  var KEY = "casefile-code";
  var dialog = document.getElementById("gate");
  if (!dialog || typeof dialog.showModal !== "function") return;
  var form = document.getElementById("gate-form");
  var input = document.getElementById("gate-input");
  var error = document.getElementById("gate-error");
  var submit = document.getElementById("gate-submit");
  var target = "/app";

  function stored() {
    try { return sessionStorage.getItem(KEY) || ""; } catch (e) { return ""; }
  }
  function keep(code) {
    try { sessionStorage.setItem(KEY, code); } catch (e) { /* storage blocked: the app will ask instead */ }
  }

  // Resolves to "ok", "wrong" or "offline".
  function check(code) {
    var headers = { Accept: "application/json" };
    if (code) headers["x-access-code"] = code;
    return fetch("/api/access", { method: "POST", headers: headers })
      .then(function (r) { return r.ok ? "ok" : r.status === 401 ? "wrong" : "offline"; })
      .catch(function () { return "offline"; });
  }

  function showError(text) {
    error.textContent = text;
    error.hidden = !text;
  }

  function open(href) {
    target = href;
    showError("");
    input.value = "";
    dialog.showModal();
    input.focus();
  }

  document.addEventListener("click", function (e) {
    var link = e.target.closest ? e.target.closest('a[href^="/app"]') : null;
    if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    var href = link.getAttribute("href");
    // Already unlocked in this tab, or no code is set on this deployment: go straight in.
    check(stored()).then(function (result) {
      if (result === "ok") location.href = href;
      else if (result === "wrong") open(href);
      else location.href = href; // Server unreachable: let the app show its own message.
    });
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var code = input.value.trim();
    if (!code) { showError("Enter the access code."); return; }
    submit.disabled = true;
    submit.textContent = "Checking";
    check(code).then(function (result) {
      submit.disabled = false;
      submit.textContent = "Open Casefile";
      if (result === "ok") {
        keep(code);
        location.href = target;
      } else if (result === "wrong") {
        showError("That code didn't work. Check it and try again.");
        input.select();
      } else {
        showError("Can't reach Casefile right now. Check your connection and try again.");
      }
    });
  });

  document.getElementById("gate-cancel").addEventListener("click", function () { dialog.close(); });
})();
