"use strict";

// ============ helpers ============

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of [].concat(children == null ? [] : children)) {
    if (c == null || c === false || c === "") continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const ICONS = {
  dispute: "M5 2.5h7l3 3v12H5z M12 2.5v3h3",
  order: "M3.5 7h13l-1 10h-11z M7 7V5.5a3 3 0 0 1 6 0V7",
  records: "M2.5 5h5.5l1.5 2h8v9.5h-15z",
  check: "M4 10.5l4 4 8-9",
  thought: "M5.5 10h.01 M10 10h.01 M14.5 10h.01",
  note: "M10 6.5v.01 M10 9.5v5",
  alert: "M10 5.5v6 M10 14.5v.01",
  back: "M12.5 4.5L7 10l5.5 5.5",
  search: "M8.5 3.5a5 5 0 1 1 0 10a5 5 0 1 1 0-10z M12.2 12.2L16.5 16.5",
  spark: "M10 3v4 M10 13v4 M3 10h4 M13 10h4"
};
function icon(name) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", ICONS[name] || ICONS.note);
  svg.append(path);
  return svg;
}

const $ = (id) => document.getElementById(id);

const REASONS = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Item not received",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Not as described",
  UNAUTHORISED: "Unauthorized payment",
  CREDIT_NOT_PROCESSED: "Refund not processed",
  DUPLICATE_TRANSACTION: "Duplicate charge",
  INCORRECT_AMOUNT: "Wrong amount charged",
  PAYMENT_BY_OTHER_MEANS: "Paid another way",
  CANCELED_RECURRING_BILLING: "Cancelled subscription",
  PROBLEM_WITH_REMITTANCE: "Payment problem",
  OTHER: "Other problem"
};
const LIFECYCLE = { INQUIRY: "Inquiry", CHARGEBACK: "Chargeback", PRE_ARBITRATION: "Pre-arbitration", ARBITRATION: "Arbitration" };
const CHANNEL = { INTERNAL: "PayPal", EXTERNAL: "Card issuer", ALERT: "Alert" };
const TOOL_INFO = {
  get_dispute: { label: "PayPal dispute", icon: "dispute" },
  get_order_details: { label: "PayPal order", icon: "order" },
  get_merchant_records: { label: "Your records", icon: "records" },
  submit_case_brief: { label: "Brief ready", icon: "check" }
};
const SOURCES = {
  PAYPAL_DISPUTE: ["Dispute", "info"],
  PAYPAL_ORDER: ["PayPal order", "info"],
  MERCHANT_RECORDS: ["Your records", ""]
};
const VERDICTS = { FIGHT: "Fight this dispute", REFUND: "Refund the buyer", OFFER: "Offer a partial refund" };
const EVIDENCE_LABELS = {
  PROOF_OF_FULFILLMENT: "Proof of delivery",
  PROOF_OF_DELIVERY_SIGNATURE: "Delivery signature",
  PROOF_OF_REFUND: "Proof of refund",
  PROOF_OF_RECEIPT_COPY: "Receipt copy",
  RETURN_POLICY: "Return policy",
  ITEM_DESCRIPTION: "Item description",
  PROOF_OF_RESHIPMENT: "Proof of reshipment",
  OTHER: "Supporting information"
};
const STAGES = [
  { key: "needs", label: "Needs response", dot: "bad", empty: "Nothing waiting on you." },
  { key: "buyer", label: "Waiting on buyer", dot: "warn", empty: "Offers and messages you send land here." },
  { key: "review", label: "PayPal reviewing", dot: "info", empty: "Cases move here after you send evidence." },
  { key: "resolved", label: "Resolved", dot: "good", empty: "Closed cases show here." }
];
function stageOf(status) {
  if (status === "WAITING_FOR_BUYER_RESPONSE") return "buyer";
  if (status === "UNDER_REVIEW" || status === "OTHER") return "review";
  if (status === "RESOLVED") return "resolved";
  return "needs";
}

function money(m) {
  if (!m || m.value == null || m.value === "") return "";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: m.currency_code || "USD" }).format(Number(m.value));
  } catch (e) {
    return m.value + " " + (m.currency_code || "");
  }
}
function date(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}
function dateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleString("en-US", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}
function hoursLeft(iso) {
  if (!iso) return null;
  const ms = new Date(iso) - Date.now();
  return isNaN(ms) ? null : ms / 3600000;
}
// "14h 20m", "2d 6h", "9 days", or "Overdue by 3h". Kept live by the ticker in views.js.
function countdownText(iso) {
  const h = hoursLeft(iso);
  if (h == null) return "No deadline";
  const abs = Math.abs(h);
  const span = abs < 1 ? Math.max(1, Math.round(abs * 60)) + "m"
    : abs < 24 ? Math.floor(abs) + "h " + Math.round((abs % 1) * 60) + "m"
    : abs < 72 ? Math.floor(abs / 24) + "d " + Math.floor(abs % 24) + "h"
    : Math.floor(abs / 24) + " days";
  return h < 0 ? "Overdue by " + span : span;
}
// Countdown bands from the spec: critical under 24 hours, warning 24 to 48, upcoming beyond.
function urgencyOf(iso) {
  const h = hoursLeft(iso);
  if (h == null) return "none";
  if (h < 24) return "critical";
  if (h < 48) return "warning";
  return "upcoming";
}
const URGENCY_TONE = { critical: "bad", warning: "warn", upcoming: "", none: "" };
function countdownEl(iso) {
  const u = urgencyOf(iso);
  return el("span", { class: "countdown badge " + URGENCY_TONE[u], "data-due": iso, text: countdownText(iso) });
}

// One status per case, combining PayPal's status with the seller's progress in Casefile.
// These are the statuses the All Disputes filters use.
const STATUS_TONE = {
  "Open": "bad", "Under investigation": "info", "Paused": "warn", "Awaiting approval": "warn", "Ready for submission": "good",
  "Submitted": "info", "Awaiting buyer": "info", "Won": "good", "Lost": "bad", "Refunded": "warn", "Resolved": ""
};
function workflowOf(item) {
  const stage = stageOf(statusOf(item));
  if (stage === "resolved") {
    const out = outcomeOf(item.dispute_id);
    return out === "won" ? "Won" : out === "lost" ? "Lost" : out === "refunded" ? "Refunded" : "Resolved";
  }
  if (stage === "review") return "Submitted";
  if (stage === "buyer") return "Awaiting buyer";
  if (state.running[item.dispute_id]) return "Under investigation";
  const run = typeof Workspace !== "undefined" ? Workspace.live[item.dispute_id] : null;
  if (run && run.status === "paused") return "Paused";
  const b = state.briefs[item.dispute_id];
  if (b) return b._reviewed ? "Ready for submission" : "Awaiting approval";
  return "Open";
}

function daysLeft(iso) {
  if (!iso) return null;
  const ms = new Date(iso) - Date.now();
  return isNaN(ms) ? null : Math.ceil(ms / 86400000);
}
// Same countdown and colours everywhere, so every view agrees on the time left.
function dueBadge(iso) {
  if (hoursLeft(iso) == null) return el("span", { class: "badge", text: "No deadline listed" });
  return countdownEl(iso);
}

// ============ state ============

const state = {
  mode: null,
  items: [],
  overrides: {},   // sample cases: local status after simulated actions
  briefs: {},      // dispute_id -> brief (saved in this browser, see store.js)
  records: {},     // dispute_id -> records the seller pasted (survive re-renders)
  results: {},     // dispute_id -> { ok, text } of the last action
  running: {},     // dispute_id -> true while an investigation is in progress
  caseData: null,
  currentId: null,
  lastView: "overview",
  run: 0
};

function statusOf(item) {
  const o = state.overrides[item.dispute_id];
  return (o && o.status) || item.status;
}
// PayPal's outcome codes, reduced to what the seller cares about:
// won (kept the money), lost (PayPal ruled for the buyer) or refunded (the seller chose to refund).
function outcomeFromCode(code) {
  const c = String(code || "");
  if (/SELLER_FAVOU?R|CANCELED_BY_BUYER|DENIED/.test(c)) return "won";
  if (/BUYER_FAVOU?R/.test(c)) return "lost";
  if (/ACCEPTED|WITH_PAYOUT|REFUNDED/.test(c)) return "refunded";
  return null;
}
const OUTCOME_TEXT = { won: "Resolved in your favor", lost: "PayPal ruled for the buyer", refunded: "Buyer refunded" };
function outcomeOf(id) {
  const o = state.overrides[id];
  if (o && o.outcome) return o.outcome;
  const item = state.items.find((i) => i.dispute_id === id);
  if (item && item.outcome) return outcomeFromCode(item.outcome);
  const cd = state.caseData;
  if (cd && cd.dispute.dispute_id === id && cd.dispute.dispute_outcome) return outcomeFromCode(cd.dispute.dispute_outcome.outcome_code);
  return null;
}

// ============ API ============

let accessCode = "";
try { accessCode = sessionStorage.getItem("casefile-code") || ""; } catch (e) { /* storage blocked */ }

async function api(path, options) {
  const opts = options || {};
  const headers = { Accept: "application/json" };
  if (opts.body) headers["Content-Type"] = "application/json";
  if (accessCode) headers["x-access-code"] = accessCode;
  let r;
  try {
    r = await fetch(path, { method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  } catch (e) {
    throw new Error("Can't reach Casefile. Check your connection and try again.");
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && data.code === "ACCESS_CODE") {
    await askForCode(Boolean(accessCode));
    return api(path, options);
  }
  if (!r.ok) {
    const err = new Error(data.error || "Something went wrong (error " + r.status + "). Try again.");
    err.debugId = data.debug_id;
    throw err;
  }
  return data;
}

let codePromise = null;
function askForCode(wasWrong) {
  if (codePromise) return codePromise;
  codePromise = new Promise((resolve) => {
    const dialog = $("access-dialog");
    $("access-error").hidden = !wasWrong;
    $("access-input").value = "";
    $("access-form").onsubmit = () => {
      accessCode = $("access-input").value.trim();
      try { sessionStorage.setItem("casefile-code", accessCode); } catch (e) { /* storage blocked */ }
      codePromise = null;
      resolve();
    };
    if (!dialog.open) dialog.showModal();
  });
  return codePromise;
}

// In-page confirmation (browser confirm() popups are often blocked).
// `extra` is an optional element shown under the text, such as the evidence packet preview.
function confirmStep(title, body, okLabel, extra) {
  return new Promise((resolve) => {
    const dialog = $("confirm-dialog");
    $("confirm-title").textContent = title;
    $("confirm-body").textContent = body;
    $("confirm-ok").textContent = okLabel || "Confirm";
    $("confirm-extra").replaceChildren(...(extra ? [extra] : []));
    dialog.classList.toggle("modal-wide", Boolean(extra));
    // The buttons answer directly, so the result never depends on form-submit and close-event timing.
    const okBtn = $("confirm-ok");
    const cancelBtn = $("confirm-cancel");
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      dialog.removeEventListener("close", onClose);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const onOk = (e) => { e.preventDefault(); finish(true); };
    const onCancel = (e) => { e.preventDefault(); finish(false); };
    const onClose = () => finish(false); // Esc or anything else that closes it counts as cancel
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    dialog.addEventListener("close", onClose);
    if (dialog.open) dialog.close();
    dialog.showModal();
    cancelBtn.focus();
  });
}

// ============ case page ============

async function openCase(id) {
  state.currentId = id;
  state.run++;
  setRoute("case-" + id);
  showPage("case-view");
  if (!Store.activity(id).some((e) => e.type === "opened")) Store.log(id, "opened");
  const view = $("case-view");
  view.replaceChildren(el("div", { class: "split" }, [caseList(), el("div", { class: "split-main" }, el("p", { class: "empty", text: "Opening case..." }))]));
  window.scrollTo(0, 0);
  try {
    const data = await api("/api/disputes?id=" + encodeURIComponent(id));
    if (state.currentId !== id) return;
    state.caseData = data;
    if (data.mode) state.mode = data.mode;
    renderCase();
    Workspace.loadDocs(id);
    $("main").focus({ preventScroll: true });
  } catch (e) {
    if (state.currentId === id) view.replaceChildren(backButton(), el("div", { class: "result bad", text: e.message }));
  }
}

function backButton() {
  const to = state.lastView || "overview";
  return el("a", { class: "btn btn-ghost back", href: "#" + to }, [icon("back"), ROUTE_TITLES[to] || "Overview"]);
}

function currentStatus() {
  const d = state.caseData.dispute;
  const o = state.overrides[d.dispute_id];
  return (o && o.status) || d.status;
}

// The four steps of a case, shown across the top of the case page.
function stepper() {
  const d = state.caseData.dispute;
  const stage = stageOf(currentStatus());
  const brief = state.briefs[d.dispute_id];
  const sent = stage !== "needs";
  const decided = stage === "resolved";
  const reviewed = Boolean(brief && brief._reviewed) || sent;
  const out = outcomeOf(d.dispute_id);
  const steps = [
    { label: "Investigate", sub: brief ? VERDICTS[brief.verdict] : sent ? "Done" : "Not started", done: Boolean(brief) || sent },
    { label: "Review", sub: reviewed ? "Approved by you" : brief ? "Check the draft below" : "", done: reviewed },
    { label: "Send", sub: sent ? "PayPal has your response" : dueBadgeText(d.seller_response_due_date), done: sent },
    { label: "PayPal decides", sub: decided ? (OUTCOME_TEXT[out] || "Closed") : sent ? "Reviewing your evidence" : "", done: decided }
  ];
  const firstOpen = steps.findIndex((s) => !s.done);
  return el("ol", { class: "stepper", id: "stepper", "aria-label": "Case progress" }, steps.map((s, i) => el("li", {
    class: s.done ? "done" : i === firstOpen ? "current" : "upcoming",
    "aria-current": i === firstOpen ? "step" : null
  }, [
    el("span", { class: "step-dot mono" }, s.done ? icon("check") : String(i + 1)),
    el("span", { class: "step-label", text: s.label }),
    s.sub ? el("span", { class: "step-sub", text: s.sub }) : null
  ])));
}
function refreshStepper() {
  const node = $("stepper");
  if (node) node.replaceWith(stepper());
}

// Status badge shared by the board cards and the case list.
function stageBadge(item) {
  const stage = stageOf(statusOf(item));
  if (stage === "needs") return dueBadge(item.seller_response_due_date);
  if (stage === "buyer") return el("span", { class: "badge warn", text: "Offer sent" });
  if (stage === "review") return el("span", { class: "badge info", text: "In review" });
  const out = outcomeOf(item.dispute_id);
  return out === "won" ? el("span", { class: "badge good", text: "Won" })
    : out === "lost" ? el("span", { class: "badge bad", text: "Lost" })
    : out === "refunded" ? el("span", { class: "badge warn", text: "Refunded" })
    : el("span", { class: "badge", text: "Closed" });
}

// Compact list of every dispute, kept beside the open case so you never lose your place.
function caseList() {
  const order = { needs: 0, buyer: 1, review: 2, resolved: 3 };
  const pool = workPool().items;
  // Keep the open case in the list even if it's from the other set (e.g. opened from a notification).
  const current = state.items.find((i) => i.dispute_id === state.currentId);
  const list = current && !pool.includes(current) ? pool.concat(current) : pool;
  const items = list.slice().sort((a, b) =>
    order[stageOf(statusOf(a))] - order[stageOf(statusOf(b))] ||
    new Date(a.seller_response_due_date || 8.64e15) - new Date(b.seller_response_due_date || 8.64e15));
  return el("aside", { class: "case-list", "aria-label": "All disputes" }, [
    el("div", { class: "case-list-head" }, [el("span", { text: "All disputes" }), el("span", { class: "count mono", text: String(items.length) })]),
    el("ul", null, items.map((item) => el("li", null, el("button", {
      type: "button",
      class: "row",
      "aria-current": item.dispute_id === state.currentId ? "true" : "false",
      onclick: () => { if (item.dispute_id !== state.currentId) openCase(item.dispute_id); }
    }, [
      el("span", { class: "row-name", text: item.buyer_name || REASONS[item.reason] || "Dispute" }),
      el("span", { class: "row-amount mono", text: money(item.dispute_amount) }),
      el("span", { class: "row-meta" }, [item.buyer_name ? (REASONS[item.reason] || "Dispute") : "Opened " + date(item.create_time), stageBadge(item)])
    ]))))
  ]);
}
function dueBadgeText(iso) {
  const h = hoursLeft(iso);
  if (h == null) return "";
  return h < 0 ? countdownText(iso) : "Due in " + countdownText(iso);
}

function renderCase() {
  const cd = state.caseData;
  const d = cd.dispute;
  const tx = (d.disputed_transactions || [])[0] || {};
  const buyer = (tx.buyer && tx.buyer.name) || "Buyer";
  const msgs = (d.messages || []).filter((m) => m.posted_by === "BUYER" || !m.posted_by);
  const stage = stageOf(currentStatus());
  const stageInfo = STAGES.find((s) => s.key === stage);

  const brief = state.briefs[d.dispute_id] ? Workspace.normalizeBrief(state.briefs[d.dispute_id]) : null;
  const unit = cd.order && Array.isArray(cd.order.purchase_units) ? cd.order.purchase_units[0] || {} : {};
  const ship = unit.shipping || {};
  const a = ship.address || {};
  const address = [a.address_line_1, a.address_line_2, a.admin_area_2, [a.admin_area_1, a.postal_code].filter(Boolean).join(" "), a.country_code].filter(Boolean).join(", ");
  // PayPal stores tracking on the order as "<capture ID>-<tracking number>".
  const tracking = (ship.trackers || []).map((t) => String(t.id || "").split("-").slice(-1)[0]).filter(Boolean);
  const items = (unit.items || []).map((i) => (i.quantity || "1") + " × " + i.name);
  const status = workflowOf(Object.assign({}, d, { buyer_name: buyer }));

  const overview = el("section", { class: "box" }, [
    el("div", { class: "box-head" }, el("h2", { text: "Case overview" })),
    el("div", { class: "complaint" }, msgs.length
      ? msgs.map((m) => el("div", { class: "quote" }, [
          el("div", { class: "quote-who", text: buyer + " · " + date(m.time_posted) }),
          el("p", { text: m.content || "" })
        ]))
      : el("p", { class: "empty", text: d.dispute_channel === "EXTERNAL" ? "No message. The buyer opened this through their card issuer." : "The buyer hasn't written anything." })),
    el("dl", { class: "details-strip" }, [
      ["Customer", buyer],
      ["Category", REASONS[d.reason] || "Other"],
      ["Transaction date", tx.create_time ? date(tx.create_time) : "Not listed"],
      ["Payment ID", tx.seller_transaction_id ? el("span", { class: "mono", text: tx.seller_transaction_id }) : "Not listed"],
      ["Order ID", cd.order && cd.order.id ? el("span", { class: "mono", text: cd.order.id }) : "No checkout order linked"],
      ["Dispute opened", date(d.create_time)],
      ["Response deadline", d.seller_response_due_date ? dateTime(d.seller_response_due_date) : "Not listed"],
      ["Stage", LIFECYCLE[d.dispute_life_cycle_stage] || "Not listed"],
      ["Filed through", CHANNEL[d.dispute_channel] || "Not listed"],
      ["Items", items.length ? el("span", null, items.map((t) => el("span", { class: "line", text: t }))) : "Not available"],
      ["Shipping address", address || "Not available"],
      ["Tracking", tracking.length ? el("span", null, tracking.map((t) => el("span", { class: "line mono", text: t }))) : "None stored on the PayPal order"]
    ].map(([k, v]) => el("div", null, [el("dt", { text: k }), el("dd", null, v)])))
  ]);

  const canStart = stage === "needs";
  const liveRun = Workspace.live[d.dispute_id];
  const headAction = liveRun && (liveRun.status === "running" || liveRun.status === "paused")
    ? el("button", { type: "button", class: "btn btn-secondary", onclick: () => Workspace.setTab("investigation") }, liveRun.status === "running" ? "Investigation running" : "Investigation paused")
    : brief
      ? el("button", { type: "button", class: "btn btn-secondary", onclick: () => Workspace.setTab("investigation") }, "View investigation")
      : canStart
        ? el("button", { type: "button", class: "btn btn-primary", onclick: () => Workspace.start({}) }, "Start investigation")
        : null;

  // The open tab's content.
  const tab = Workspace.tabOf(d.dispute_id);
  let tabContent;
  if (tab === "overview") {
    tabContent = [overview, evidenceSummary(brief), activityTimeline(d, stage)];
  } else if (tab === "response") {
    tabContent = [
      brief ? el("div", { id: "brief", class: "case-main" }) : el("section", { class: "box" }, [
        el("p", { class: "empty-state", text: "Casefile drafts your response after the investigation." }),
        canStart ? el("button", { type: "button", class: "btn btn-primary", onclick: () => Workspace.start({}) }, "Start investigation") : null
      ]),
      sandboxTools()
    ];
  } else {
    const host = el("div", { class: "case-main" });
    Workspace.renderTab(host);
    tabContent = [host];
  }

  $("case-view").replaceChildren(el("div", { class: "split" }, [caseList(), el("div", { class: "split-main" }, [
    backButton(),
    el("header", { class: "case-head" }, [
      el("div", { class: "case-title" }, [
        el("h1", { text: buyer }),
        el("p", { class: "case-meta" }, [
          el("span", { class: "mono", text: d.dispute_id }),
          " · " + (REASONS[d.reason] || "Dispute")
        ]),
        el("div", { class: "case-badges" }, [
          el("span", { class: "badge " + STATUS_TONE[status], text: status }),
          cd.sample ? el("span", { class: "badge", text: "Sample case" }) : null
        ])
      ]),
      el("div", { class: "case-money" }, [
        el("div", { class: "amount mono", text: money(d.dispute_amount) }),
        stage === "needs" && d.seller_response_due_date
          ? el("div", { class: "sub" }, ["Respond within ", countdownEl(d.seller_response_due_date)])
          : el("div", { class: "sub", text: stageInfo.label }),
        headAction
      ])
    ]),
    cd.sample ? el("p", { class: "notice notice-info", text: "Sample case with invented data. The investigation runs for real; your decision is simulated and nothing is sent to PayPal." }) : null,
    stepper(),
    Workspace.tabBar(d.dispute_id),
    el("div", { class: "case-body" }, el("div", { class: "case-main" }, tabContent))
  ])]));
  if (brief && tab === "response") renderBrief(brief);
}

// Where the investigation stands, in the seller's terms.
function investigationStage(id, stage) {
  if (stage === "resolved") return "Resolved";
  if (stage !== "needs") return "Submitted";
  if (state.running[id]) return "In progress";
  if (Workspace.live[id] && Workspace.live[id].status === "paused") return "Paused";
  const b = state.briefs[id];
  if (!b) return "Not started";
  return b._reviewed ? "Approved, ready to submit" : "Recommendation ready, awaiting your approval";
}

function evidenceSummary(brief) {
  const box = el("section", { class: "box" }, el("div", { class: "box-head" }, el("h2", { text: "Evidence summary" })));
  if (!brief) {
    box.append(el("p", { class: "empty", text: "Run the investigation to see what evidence you have, what's missing and what needs your review." }));
    return box;
  }
  const assess = brief.evidence_assessment || [];
  const docs = (state.caseData.documents || []).length + ((Workspace.uploaded[state.currentId] || []).length);
  const verified = assess.filter((e) => e.verification === "VERIFIED_BY_PAYPAL").length;
  const review = (brief.claims || []).filter((c) => c.finding === "UNABLE_TO_VERIFY").length + brief._flags.length;
  const figures = [
    [docs, "Evidence documents", "Sample, uploaded and pasted records", ""],
    [brief.missing.length, "Missing items", "Would make the case stronger", brief.missing.length ? "warn" : ""],
    [verified, "Verified records", "Confirmed by PayPal's own data", "good"],
    [review, "Need your review", "Unverifiable claims and flagged findings", review ? "warn" : ""]
  ];
  box.append(el("div", { class: "ev-summary" }, figures.map(([n, label, sub, tone]) => el("div", { class: "ev-fig " + tone }, [
    el("span", { class: "ev-num mono", text: String(n) }),
    el("span", { class: "ev-label", text: label }),
    el("span", { class: "ev-sub", text: sub })
  ]))));
  return box;
}

// Only events that actually happened: from PayPal's data plus what the seller did in Casefile.
const ACTIVITY_TEXT = {
  opened: "You opened the case in Casefile",
  investigation_started: "Investigation started",
  investigation_completed: "Recommendation ready",
  approved: "You approved the response",
  provide_evidence: "Response and evidence sent to PayPal",
  make_offer: "Partial refund offer sent",
  accept_claim: "Claim accepted, buyer refunded",
  send_message: "Message sent to the buyer",
  escalate: "Escalated to a PayPal claim",
  investigation_paused: "Investigation paused",
  investigation_resumed: "Investigation resumed",
  document_added: "Document added",
  document_removed: "Document removed",
  finding_flagged: "You flagged a finding as incorrect",
  note_added: "Internal note added",
  adjudicate: "PayPal decision (sandbox simulation)"
};
function activityTimeline(d, stage) {
  const events = [];
  if (d.create_time) events.push({ at: d.create_time, text: "Dispute received from PayPal", tone: "info" });
  for (const m of d.messages || []) {
    if (!m.time_posted) continue;
    const who = m.posted_by === "SELLER" ? "You wrote" : m.posted_by === "ARBITER" ? "PayPal wrote" : "Buyer wrote";
    const content = String(m.content || "");
    events.push({ at: m.time_posted, text: who + ": “" + content.slice(0, 140) + (content.length > 140 ? "..." : "") + "”", tone: "" });
  }
  for (const e of Store.activity(d.dispute_id)) {
    events.push({ at: e.at, text: (ACTIVITY_TEXT[e.type] || e.type) + (e.detail ? ": " + e.detail : ""), tone: e.type === "approved" || e.type === "investigation_completed" ? "good" : "" });
  }
  if (stage === "resolved" && (d.update_time || d.create_time)) {
    events.push({ at: d.update_time || d.create_time, text: "Dispute resolved: " + (OUTCOME_TEXT[outcomeOf(d.dispute_id)] || "closed"), tone: "good" });
  }
  events.sort((x, y) => new Date(x.at) - new Date(y.at));
  return el("section", { class: "box" }, [
    el("div", { class: "box-head" }, el("h2", { text: "Activity" })),
    el("ol", { class: "activity" }, events.map((e) => el("li", { class: e.tone }, [
      el("span", { class: "act-dot", "aria-hidden": "true" }),
      el("span", { class: "act-text", text: e.text }),
      el("time", { class: "act-time", datetime: e.at, text: dateTime(e.at) })
    ])))
  ]);
}

// ============ investigation (one server turn per request) ============

function feedItem(item) {
  const info = item.kind === "tool" ? TOOL_INFO[item.name] || { label: item.name, icon: "note" } : null;
  const iconName = item.error ? "alert" : info ? info.icon : item.kind === "thought" ? "thought" : item.kind === "working" ? "spark" : "note";
  return el("li", { class: [item.kind, item.error ? "error" : ""].join(" ").trim() }, [
    el("span", { class: "feed-icon" }, icon(iconName)),
    el("div", null, [info ? el("span", { class: "feed-src", text: info.label }) : null, item.text])
  ]);
}

// ============ brief + decision ============

function counted(textarea, max) {
  const counter = el("div", { class: "char-count" });
  const update = () => {
    counter.textContent = textarea.value.length + " / " + max;
    counter.classList.toggle("over", textarea.value.length > max);
  };
  textarea.addEventListener("input", update);
  update();
  return counter;
}

const FINDINGS = {
  CONTRADICTED: ["Contradicted", "good"],
  SUPPORTED: ["Confirmed", "warn"],
  UNVERIFIED: ["Can't verify", ""]
};

// Each buyer claim lined up against what the evidence shows.
function claimCheck(b, dispute) {
  const claims = Array.isArray(b.claim_check) ? b.claim_check : [];
  if (!claims.length) return null;
  const said = (dispute.messages || []).map((m) => String(m.content || ""));
  return el("section", { class: "box" }, [
    el("div", { class: "box-head" }, el("h2", { text: "Buyer says vs. evidence shows" })),
    el("div", { class: "claims" }, [
      el("div", { class: "claims-head", "aria-hidden": "true" }, [
        el("span", { text: "Buyer says" }), el("span", { text: "Finding" }), el("span", { text: "Evidence shows" })
      ]),
      ...claims.map((c) => {
        const [label, tone] = FINDINGS[c.finding] || FINDINGS.UNVERIFIED;
        const [srcLabel, srcTone] = SOURCES[c.source] || [c.source, ""];
        // Quote marks only when the buyer really wrote these words.
        const quoted = c.claim.length > 8 && said.some((s) => s.includes(c.claim.replace(/[.\s]+$/, "")));
        return el("div", { class: "claim" }, [
          el("p", { class: "claim-text" + (quoted ? " quoted" : ""), text: c.claim }),
          el("span", { class: "badge finding " + tone, text: label }),
          el("div", { class: "claim-evidence" }, [el("p", { text: c.evidence }), el("span", { class: "badge " + srcTone, text: srcLabel })])
        ]);
      })
    ])
  ]);
}

// Mirrors buildEvidences() in api/act.js, so the preview shows exactly what the server sends.
function packetPreview(b, list, disputeId) {
  const carriers = ["USPS", "UPS", "FEDEX", "DHL", "OTHER"];
  const items = list.map((e) => {
    const tracking = String(e.tracking_number || "").replace(/\s+/g, "");
    let type = e.evidence_type;
    if (type === "PROOF_OF_FULFILLMENT" && !(tracking && carriers.includes(e.carrier))) type = "OTHER";
    return {
      type,
      notes: String(e.summary || "").trim().slice(0, 1000),
      tracking: type === "PROOF_OF_FULFILLMENT" ? (e.carrier === "OTHER" ? e.carrier_other_name || "Other" : e.carrier) + " · " + tracking : ""
    };
  });
  const note = String(b.response_note || "").trim().slice(0, 2000);
  if (!items.length) items.push({ type: "OTHER", notes: note, tracking: "" });
  else if (note) items[0].notes = note;

  return el("div", { class: "packet" }, [
    el("div", { class: "packet-meta" }, [
      el("span", null, ["Dispute ", el("span", { class: "mono", text: disputeId })]),
      el("span", { text: items.length + (items.length === 1 ? " evidence item" : " evidence items") })
    ]),
    ...items.map((it, i) => el("div", { class: "packet-item" }, [
      el("div", { class: "packet-item-head" }, [
        el("span", { text: (i + 1) + ". " + (EVIDENCE_LABELS[it.type] || it.type) }),
        el("span", { class: "badge mono", text: it.type })
      ]),
      it.tracking ? el("div", { class: "packet-tracking mono", text: "Tracking: " + it.tracking }) : null,
      el("p", { class: "packet-notes", text: it.notes || "No notes" })
    ])),
    el("p", { class: "packet-foot", text: "Your message to the buyer is sent separately and isn't part of this packet." })
  ]);
}

function meter(conf) {
  const n = { LOW: 1, MEDIUM: 2, HIGH: 3 }[conf] || 1;
  return el("div", { class: "meter" }, [
    el("div", { class: "meter-bars", "aria-hidden": "true" }, [1, 2, 3].map((i) => el("span", { class: i <= n ? "on" : "" }))),
    conf.charAt(0) + conf.slice(1).toLowerCase() + " confidence"
  ]);
}

// Carries out an action on the open case after the seller confirms it.
async function doAction(action, extra, title, body, okLabel, preview) {
  const cd = state.caseData;
  const id = cd.dispute.dispute_id;
  if (!(await confirmStep(title, body, okLabel, preview))) return;
  document.querySelectorAll("#case-view .split-main button").forEach((x) => { x.disabled = true; });
  try {
    const r = await api("/api/act", { method: "POST", body: Object.assign({ dispute_id: id, action }, extra) });
    state.results[id] = { ok: true, text: r.message };
    const detail = action === "make_offer" ? money({ currency_code: extra.currency, value: extra.amount })
      : action === "provide_evidence" ? (extra.evidence || []).length + " evidence item" + ((extra.evidence || []).length === 1 ? "" : "s")
      : action === "adjudicate" ? (extra.outcome === "SELLER_FAVOR" ? "in your favor" : "for the buyer")
      : "";
    Store.log(id, action, (detail ? detail : "") + (r.sample ? (detail ? " " : "") + "(sample, simulated)" : ""));
    if (r.sample) {
      const next = {
        provide_evidence: { status: "UNDER_REVIEW" },
        make_offer: { status: "WAITING_FOR_BUYER_RESPONSE" },
        accept_claim: { status: "RESOLVED", outcome: "refunded" },
        adjudicate: extra.outcome === "SELLER_FAVOR" ? { status: "RESOLVED", outcome: "won" } : { status: "RESOLVED", outcome: "lost" }
      }[action];
      if (next) {
        state.overrides[id] = next;
        Store.saveOverrides(state.overrides);
      }
      Notify.sync();
    } else {
      if (r.dispute) {
        if (r.dispute.status) cd.dispute.status = r.dispute.status;
        if (r.dispute.actions) cd.actions = r.dispute.actions;
        const item = state.items.find((i) => i.dispute_id === id);
        if (item && r.dispute.status) item.status = r.dispute.status;
      }
      // Remember how a real case ended, so the board and Money protected reflect it straight away.
      if (action === "adjudicate") {
        state.overrides[id] = { status: "RESOLVED", outcome: extra.outcome === "SELLER_FAVOR" ? "won" : "lost" };
      } else if (action === "accept_claim") {
        state.overrides[id] = { status: (r.dispute && r.dispute.status) || "RESOLVED", outcome: "refunded" };
      }
      Store.saveOverrides(state.overrides);
      loadInbox();
      // Escalating changes the dispute's stage, so load it fresh from PayPal.
      if (action === "escalate") {
        if (state.currentId === id) await openCase(id);
        return;
      }
    }
  } catch (e) {
    state.results[id] = { ok: false, text: e.message + (e.debugId ? " (PayPal debug ID " + e.debugId + ")" : "") };
  }
  if (state.currentId === id) renderCase();
}

// Sandbox-only helpers that play the buyer's and PayPal's parts, so a demo can reach a decision.
// Shown whether or not the case has been investigated, so they survive a page reload.
function sandboxTools() {
  const cd = state.caseData;
  const d = cd.dispute;
  const stage = stageOf(currentStatus());
  const realSandbox = !cd.sample && cd.mode && cd.mode.env === "sandbox";
  const canEscalate = realSandbox && d.dispute_life_cycle_stage === "INQUIRY" && stage !== "resolved";
  const canDecide = stage === "review" && (cd.sample || realSandbox);
  if (!canEscalate && !canDecide) return null;
  const result = state.results[d.dispute_id];
  const hasBrief = Boolean(state.briefs[d.dispute_id]);
  return el("section", { class: "box" }, [
    el("div", { class: "box-head" }, el("h2", { text: cd.sample ? "Finish the story" : "Sandbox tools" })),
    el("p", { class: "box-hint", text: cd.sample
      ? "Sample case: play PayPal's reviewer to see how the case ends."
      : "Only in the PayPal sandbox. These play the buyer's and PayPal's parts so the demo can reach a decision." }),
    el("div", { class: "decide" }, [
      canEscalate ? el("button", { type: "button", class: "btn btn-secondary", onclick: () => doAction("escalate", {},
        "Escalate to a PayPal claim?",
        "This turns the inquiry into a claim, the stage where PayPal decides. You may need to send your evidence again afterwards.",
        "Escalate") }, "Escalate to a claim") : null,
      canDecide ? el("button", { type: "button", class: "btn btn-secondary", onclick: () => doAction("adjudicate", { outcome: "SELLER_FAVOR" },
        "Simulate PayPal ruling for you?", "This uses PayPal's sandbox tool to close the case in your favor.", "Simulate") }, "Simulate: you win") : null,
      canDecide ? el("button", { type: "button", class: "btn btn-secondary", onclick: () => doAction("adjudicate", { outcome: "BUYER_FAVOR" },
        "Simulate PayPal ruling for the buyer?", "This uses PayPal's sandbox tool to close the case in the buyer's favor.", "Simulate") }, "Simulate: buyer wins") : null
    ]),
    // Without a brief there's no decision box, so show the last result here.
    !hasBrief && result ? el("div", { class: "result " + (result.ok ? "ok" : "bad"), text: result.text }) : null
  ]);
}

function renderBrief(b) {
  const cd = state.caseData;
  const id = cd.dispute.dispute_id;
  const stage = stageOf(currentStatus());
  const allowed = new Set(cd.actions || []);
  const currency = (cd.dispute.dispute_amount && cd.dispute.dispute_amount.currency_code) || "USD";
  const open = stage === "needs";

  // Editable fields write back into the brief so edits survive re-renders.
  const noteBox = el("textarea", { id: "note", rows: "9", maxlength: "2000" });
  noteBox.value = b.response_note;
  noteBox.addEventListener("input", () => { b.response_note = noteBox.value; Store.saveBriefsSoon(state.briefs); });
  const buyerBox = el("textarea", { id: "buyer-msg", rows: "4", maxlength: "2000" });
  buyerBox.value = b.buyer_message;
  buyerBox.addEventListener("input", () => { b.buyer_message = buyerBox.value; Store.saveBriefsSoon(state.briefs); });
  const offerInput = el("input", { type: "text", id: "offer", inputmode: "decimal", value: b.offer_amount || "" });
  offerInput.addEventListener("input", () => { b.offer_amount = offerInput.value; });

  if (!b._chosen) b._chosen = b.evidence.map(() => true);
  const chosen = () => b.evidence.filter((e, i) => b._chosen[i]);

  const act = doAction;

  const DEFS = {
    provide_evidence: ["Submit evidence to PayPal", () => act("provide_evidence",
      { response_note: noteBox.value, evidence: chosen() },
      "Review what PayPal will receive",
      "This is exactly what goes to PayPal's reviewer. You can't edit it after sending.",
      "Send to PayPal",
      packetPreview(b, chosen(), id))],
    make_offer: ["Send partial refund offer", () => act("make_offer",
      { amount: offerInput.value.trim(), currency, note: buyerBox.value },
      "Offer " + money({ currency_code: currency, value: offerInput.value.trim() || "0" }) + " to the buyer?",
      "The buyer can accept or decline. If they accept, PayPal refunds that amount and closes the dispute.",
      "Send offer")],
    accept_claim: ["Accept claim and refund", () => act("accept_claim",
      { note: buyerBox.value },
      "Accept the claim?",
      "PayPal will refund the buyer " + money(cd.dispute.dispute_amount) + " and close the dispute. This can't be undone.",
      "Accept and refund")],
    send_message: ["Message the buyer", () => act("send_message",
      { message: buyerBox.value },
      "Send this message to the buyer?",
      "It goes through PayPal's dispute messages, and PayPal can read it too.",
      "Send message")]
  };
  const primary = { FIGHT: "provide_evidence", REFUND: "accept_claim", OFFER: "make_offer" }[b.verdict];
  // Sending buttons stay locked until the seller ticks "I've reviewed".
  const button = (action, cls) => el("button", {
    type: "button", class: "btn " + cls, "data-gated": true, disabled: !b._reviewed, onclick: DEFS[action][1]
  }, DEFS[action][0]);
  const gate = () => document.querySelectorAll("#brief [data-gated]").forEach((x) => { x.disabled = !b._reviewed; });
  const reviewBox = el("input", { type: "checkbox", id: "reviewed", checked: Boolean(b._reviewed) });
  reviewBox.addEventListener("change", () => {
    b._reviewed = reviewBox.checked;
    if (b._reviewed) Store.log(id, "approved");
    Store.saveBriefs(state.briefs);
    gate();
    refreshStepper();
    Notify.sync();
  });
  const approval = el("label", { class: "approve", for: "reviewed" }, [
    reviewBox,
    el("span", null, [
      el("strong", { text: "I've reviewed the response, the evidence and the message to the buyer" }),
      el("span", { class: "approve-sub", text: "Casefile only sends to PayPal after you tick this and confirm." })
    ])
  ]);
  const goToDecision = () => {
    const target = $("decision");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    const r = $("reviewed");
    if (r) r.focus({ preventScroll: true });
  };
  const others = Object.keys(DEFS).filter((a) => a !== primary && allowed.has(a));

  const result = state.results[id];

  $("brief").replaceChildren(
    el("section", { class: "verdict " + b.verdict }, [
      el("div", { class: "verdict-top" }, [el("span", { class: "verdict-label", text: "Recommendation" }), meter(b.confidence)]),
      el("div", { class: "verdict-call", text: VERDICTS[b.verdict] }),
      el("p", { class: "verdict-headline", text: b.headline }),
      el("p", { class: "verdict-reasoning", text: b.reasoning }),
      open ? el("div", { class: "verdict-actions" }, el("button", { type: "button", class: "btn btn-primary btn-lg", onclick: goToDecision }, "Review and send")) : null,
      open ? el("p", { class: "box-hint", text: "Check the draft below, then approve it at the bottom of the page." }) : null
    ]),
    el("p", { class: "muted small tab-links" }, [
      "The evidence behind this recommendation: ",
      el("button", { type: "button", class: "link-btn", onclick: () => Workspace.setTab("contradictions") }, "buyer's claims vs. your evidence"),
      ", ",
      el("button", { type: "button", class: "link-btn", onclick: () => Workspace.setTab("evidence") }, "evidence strength"),
      ", ",
      el("button", { type: "button", class: "link-btn", onclick: () => Workspace.setTab("summary") }, "full summary"),
      "."
    ]),
    b.evidence.length ? el("section", { class: "box" }, [
      el("div", { class: "box-head" }, [
        el("h2", { text: "Evidence to send" }),
        el("span", { class: "badge" + (chosen().length ? " good" : ""), id: "ev-count", text: chosen().length + " of " + b.evidence.length + " ready to send" })
      ]),
      el("div", { class: "evidence" }, b.evidence.map((e, i) => {
        const box = el("input", { type: "checkbox", id: "ev-" + i, checked: b._chosen[i] });
        box.addEventListener("change", () => {
          b._chosen[i] = box.checked;
          Store.saveBriefs(state.briefs);
          const count = $("ev-count");
          count.textContent = chosen().length + " of " + b.evidence.length + " ready to send";
          count.className = "badge" + (chosen().length ? " good" : "");
        });
        return el("label", { class: "ev", for: "ev-" + i }, [
          box,
          el("span", { class: "ev-type", text: EVIDENCE_LABELS[e.evidence_type] || e.evidence_type }),
          el("span", { class: "ev-summary", text: e.summary }),
          e.tracking_number ? el("span", { class: "ev-tracking mono", text: (e.carrier === "OTHER" ? e.carrier_other_name : e.carrier) + " · " + e.tracking_number }) : null
        ]);
      }))
    ]) : null,
    el("section", { class: "box" }, [
      el("div", { class: "box-head" }, el("h2", null, el("label", { for: "note", text: "Response to PayPal" }))),
      el("p", { class: "box-hint", text: "Written for the PayPal reviewer. Edit anything before you send it." }),
      noteBox,
      counted(noteBox, 2000)
    ]),
    el("section", { class: "box" }, [
      el("div", { class: "box-head" }, el("h2", null, el("label", { for: "buyer-msg", text: "Message to the buyer" }))),
      buyerBox,
      counted(buyerBox, 2000),
      b.verdict === "OFFER" || allowed.has("make_offer") ? el("div", null, [
        el("label", { for: "offer", class: "field-label", text: "Partial refund amount (" + currency + ")" }),
        el("div", { class: "offer-row" }, offerInput)
      ]) : null
    ]),
    b.missing && b.missing.length ? el("p", { class: "notice notice-warn" }, [
      b.missing.length + " piece" + (b.missing.length === 1 ? "" : "s") + " of evidence would make this case stronger. ",
      el("button", { type: "button", class: "link-btn", onclick: () => Workspace.setTab("missing") }, "See what's missing")
    ]) : null,
    el("section", { class: "box", id: "decision" }, [
      el("div", { class: "box-head" }, el("h2", { text: "Your decision" })),
      open ? approval : null,
      open
        ? el("div", { class: "decide" }, [
            allowed.has(primary) ? button(primary, "btn-primary") : null,
            ...others.map((a) => button(a, "btn-secondary"))
          ])
        : el("p", { class: "empty", text: stage === "resolved" ? "This case is closed." : "Your response is with PayPal. Nothing else to do until they decide." }),
      result ? el("div", { class: "result " + (result.ok ? "ok" : "bad"), text: result.text }) : null
    ])
  );
}

