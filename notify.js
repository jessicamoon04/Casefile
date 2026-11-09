"use strict";

// Notifications, built only from real events in the case data and the seller's own actions.
// Each notice has a stable key, so the same event never notifies twice.
const Notify = (() => {
  const TYPES = {
    new_dispute: { label: "New disputes", tone: "info", icon: "dispute" },
    deadline: { label: "Deadline reminders", tone: "bad", icon: "alert" },
    action: { label: "Cases needing your response", tone: "warn", icon: "note" },
    investigation: { label: "Investigations finished", tone: "good", icon: "check" },
    evidence: { label: "Missing evidence", tone: "warn", icon: "records" },
    approval: { label: "Responses awaiting approval", tone: "info", icon: "note" },
    outcome: { label: "Dispute outcomes", tone: "good", icon: "check" }
  };
  const FRESH_MS = 3 * 86400000; // on first visit, only events from the last 3 days become notices
  let list = Store.notifications();

  function save() { Store.saveNotifications(list.slice(0, 100)); }

  function add(key, type, caseId, title, detail, at) {
    if (list.some((n) => n.key === key)) return;
    list.unshift({ key, type, caseId, title, detail, at: at || new Date().toISOString(), read: false });
    list = list.slice(0, 100);
  }

  function describe(item) {
    return (REASONS[item.reason] || "Dispute") + ", " + money(item.dispute_amount) + (item.buyer_name ? " from " + item.buyer_name : "");
  }

  // Look at the current cases and add any notices that are due.
  function sync() {
    const { items, sampleOnly } = workPool();
    const prefs = Store.prefs();
    let seen = Store.seen();
    const firstRun = !seen;
    seen = seen || {};
    const now = Date.now();

    for (const item of items) {
      const id = item.dispute_id;
      const stage = stageOf(statusOf(item));
      const before = seen[id];
      const tag = sampleOnly ? " (sample)" : "";

      // New dispute: first time this ID shows up.
      if (!before) {
        const age = now - new Date(item.create_time || 0);
        if (!firstRun || age < FRESH_MS) {
          add("new:" + id, "new_dispute", id, "New dispute" + tag, describe(item), item.create_time);
        }
      }

      // Outcome: the case became resolved since we last looked.
      if (stage === "resolved" && (!before || before.stage !== "resolved")) {
        const when = item.resolved_time || item.update_time;
        const recent = when && now - new Date(when) < FRESH_MS;
        if ((before && before.stage !== "resolved") || recent) {
          const out = outcomeOf(id);
          add("outcome:" + id, "outcome", id, (OUTCOME_TEXT[out] || "Dispute closed") + tag, describe(item), when || undefined);
        }
      }

      if (stage === "needs") {
        // Deadline reminders at the thresholds the seller chose; only the tightest one crossed.
        const h = hoursLeft(item.seller_response_due_date);
        if (h != null) {
          const r = prefs.reminders;
          let mark = null;
          if (h < 0) mark = "overdue";
          else if (h <= 6 && r.h6) mark = "6";
          else if (h <= 24 && r.h24) mark = "24";
          else if (h <= 48 && r.h48) mark = "48";
          if (mark) {
            const title = mark === "overdue" ? "Deadline passed" : "Under " + mark + " hours to respond";
            add("deadline:" + id + ":" + mark, "deadline", id, title + tag, describe(item));
          }
        }
        const b = state.briefs[id];
        if (!b) {
          add("action:" + id, "action", id, "Needs your response" + tag, describe(item), item.create_time);
        } else {
          add("investigation:" + id + ":" + b._at, "investigation", id, "Investigation finished" + tag,
            VERDICTS[b.verdict] + ", " + String(b.confidence).toLowerCase() + " confidence. " + describe(item), b._at);
          const gaps = Array.isArray(b.missing) ? b.missing.map((m) => m.item) : (b.gaps || []);
          if (gaps.length) {
            add("evidence:" + id + ":" + b._at, "evidence", id, gaps.length + " missing evidence item" + (gaps.length === 1 ? "" : "s") + tag, gaps[0], b._at);
          }
          if (!b._reviewed) {
            add("approval:" + id + ":" + b._at, "approval", id, "Response awaiting your approval" + tag, describe(item), b._at);
          }
        }
      }
      seen[id] = { stage };
    }
    Store.saveSeen(seen);
    list.sort((x, y) => new Date(y.at) - new Date(x.at));
    save();
    render();
  }

  function visible() {
    const prefs = Store.prefs();
    return list.filter((n) => prefs.notify[n.type] !== false);
  }

  function setRead(key) {
    const n = list.find((x) => x.key === key);
    if (n && !n.read) {
      n.read = true;
      save();
      render();
    }
  }
  function markAll() {
    list.forEach((n) => { n.read = true; });
    save();
    render();
  }

  function timeAgo(iso) {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (isNaN(s)) return "";
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    if (s < 86400 * 7) return Math.floor(s / 86400) + "d ago";
    return date(iso);
  }

  function render() {
    const shown = visible();
    const unread = shown.filter((n) => !n.read).length;
    const badge = $("bell-count");
    badge.hidden = unread === 0;
    badge.textContent = unread > 99 ? "99+" : String(unread);
    $("bell").setAttribute("aria-label", unread ? "Notifications, " + unread + " unread" : "Notifications");

    const panel = $("notif-panel");
    panel.replaceChildren(
      el("div", { class: "np-head" }, [
        el("h2", { text: "Notifications" }),
        el("button", { type: "button", class: "btn btn-ghost btn-sm", disabled: unread === 0, onclick: markAll }, "Mark all as read")
      ]),
      shown.length
        ? el("ul", { class: "np-list" }, shown.slice(0, 40).map((n) => {
            const t = TYPES[n.type] || TYPES.action;
            return el("li", null, el("button", {
              type: "button",
              class: "np-item" + (n.read ? "" : " unread"),
              onclick: () => { setRead(n.key); close(); if (n.caseId) openCase(n.caseId); }
            }, [
              el("span", { class: "np-icon " + t.tone }, icon(t.icon)),
              el("span", { class: "np-body" }, [
                el("span", { class: "np-title", text: n.title }),
                el("span", { class: "np-detail", text: n.detail || "" }),
                el("span", { class: "np-time", text: timeAgo(n.at) })
              ]),
              n.read ? null : el("span", { class: "np-dot", "aria-label": "Unread" })
            ]));
          }))
        : el("p", { class: "np-empty", text: "You're all caught up. New disputes, deadlines and outcomes will show here." }),
      el("div", { class: "np-foot" }, el("a", { href: "#preferences", onclick: close }, "Notification settings"))
    );
  }

  function open() {
    $("notif-panel").hidden = false;
    $("bell").setAttribute("aria-expanded", "true");
  }
  function close() {
    $("notif-panel").hidden = true;
    $("bell").setAttribute("aria-expanded", "false");
  }
  function toggle() {
    if ($("notif-panel").hidden) open(); else close();
  }

  function init() {
    $("bell").addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
    $("notif-panel").addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", close);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    render();
  }

  return { init, sync, render, TYPES };
})();
