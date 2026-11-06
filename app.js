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
function daysLeft(iso) {
  if (!iso) return null;
  const ms = new Date(iso) - Date.now();
  return isNaN(ms) ? null : Math.ceil(ms / 86400000);
}
function dueBadge(iso) {
  const n = daysLeft(iso);
  if (n == null) return el("span", { class: "badge", text: "No deadline listed" });
  if (n < 0) return el("span", { class: "badge bad", text: "Overdue" });
  if (n === 0) return el("span", { class: "badge bad", text: "Due today" });
  return el("span", { class: "badge " + (n <= 3 ? "bad" : n <= 7 ? "warn" : ""), text: n + (n === 1 ? " day left" : " days left") });
}

// ============ state ============

const state = {
  mode: null,
  items: [],
  overrides: {},   // sample cases: local status after simulated actions
  briefs: {},      // dispute_id -> brief (kept while the page is open)
  records: {},     // dispute_id -> records the seller pasted (survive re-renders)
  results: {},     // dispute_id -> { ok, text } of the last action
  caseData: null,
  currentId: null,
  run: 0
};

function statusOf(item) {
  const o = state.overrides[item.dispute_id];
  return (o && o.status) || item.status;
}
function outcomeOf(id) {
  const o = state.overrides[id];
  return o && o.outcome;
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
function confirmStep(title, body, okLabel) {
  return new Promise((resolve) => {
    const dialog = $("confirm-dialog");
    $("confirm-title").textContent = title;
    $("confirm-body").textContent = body;
    $("confirm-ok").textContent = okLabel || "Confirm";
    dialog.returnValue = "";
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
    dialog.showModal();
    $("confirm-cancel").focus();
  });
}

// ============ sidebar + board ============

function renderStatus() {
  const m = state.mode;
  if (!m) return;
  $("status").replaceChildren(
    el("span", { class: "conn" + (m.paypal ? " on" : "") }, m.paypal ? "PayPal " + m.env + " connected" : "PayPal not connected"),
    el("span", { class: "conn" + (m.ai ? " on" : "") }, m.ai ? "AI agent ready" : "AI not connected")
  );
  $("nav-store-item").hidden = !(m.paypal && m.env === "sandbox");
}

function renderStats() {
  // Totals come from real disputes only. Sample cases are counted only when there are no real ones,
  // and then the cards say so, so invented money is never mixed with real money.
  const realItems = state.items.filter((i) => !i.sample);
  const sampleOnly = realItems.length === 0;
  const pool = sampleOnly ? state.items : realItems;
  const tag = sampleOnly ? " (sample cases)" : "";
  const open = pool.filter((i) => stageOf(statusOf(i)) !== "resolved");
  const needs = pool.filter((i) => stageOf(statusOf(i)) === "needs");

  const byCurrency = {};
  for (const i of open) {
    const m = i.dispute_amount;
    if (!m || !m.value) continue;
    byCurrency[m.currency_code] = (byCurrency[m.currency_code] || 0) + Math.round(Number(m.value) * 100);
  }
  const currencies = Object.keys(byCurrency).sort((a, b) => byCurrency[b] - byCurrency[a]);
  if (currencies.length) {
    const main = currencies[0];
    $("stat-risk").textContent = money({ currency_code: main, value: (byCurrency[main] / 100).toFixed(2) });
    $("stat-risk-foot").textContent = "Across " + open.length + " open case" + (open.length === 1 ? "" : "s") +
      (currencies.length > 1 ? ", plus other currencies" : "") + tag;
  } else {
    $("stat-risk").textContent = money({ currency_code: "USD", value: "0" });
    $("stat-risk-foot").textContent = "No open cases" + tag;
  }

  $("stat-open").textContent = String(needs.length);
  $("stat-open-foot").textContent = (needs.length ? "Respond before PayPal decides without you" : "You're all caught up") + tag;
  $("nav-count").textContent = needs.length ? String(needs.length) : "";

  const dated = needs.filter((i) => daysLeft(i.seller_response_due_date) != null)
    .sort((a, b) => new Date(a.seller_response_due_date) - new Date(b.seller_response_due_date));
  const foot = $("stat-due-foot");
  if (dated.length) {
    const next = dated[0];
    const n = daysLeft(next.seller_response_due_date);
    $("stat-due").textContent = n < 0 ? "Overdue" : n === 0 ? "Today" : n + (n === 1 ? " day" : " days");
    foot.textContent = money(next.dispute_amount) + " · " + (REASONS[next.reason] || "Dispute") + tag;
    foot.className = "stat-foot" + (n <= 3 ? " bad" : "");
  } else {
    $("stat-due").textContent = "None";
    foot.textContent = needs.length ? "PayPal hasn't listed a date" : "Nothing due";
    foot.className = "stat-foot";
  }
}

function caseCard(item) {
  const stage = stageOf(statusOf(item));
  let badge;
  if (stage === "needs") badge = dueBadge(item.seller_response_due_date);
  else if (stage === "buyer") badge = el("span", { class: "badge warn", text: "Offer sent" });
  else if (stage === "review") badge = el("span", { class: "badge info", text: "In review" });
  else {
    const out = outcomeOf(item.dispute_id);
    badge = out === "won" ? el("span", { class: "badge good", text: "Won" })
      : out === "refunded" ? el("span", { class: "badge warn", text: "Refunded" })
      : el("span", { class: "badge", text: "Closed" });
  }
  return el("li", null, el("button", { type: "button", class: "card", onclick: () => openCase(item.dispute_id) }, [
    el("div", { class: "card-top" }, [
      el("span", { class: "card-reason", text: REASONS[item.reason] || "Dispute" }),
      item.sample ? el("span", { class: "badge", text: "Sample" }) : null
    ]),
    el("div", { class: "card-amount mono", text: money(item.dispute_amount) || "Amount not listed" }),
    el("div", { class: "card-buyer", text: item.buyer_name || "Opened " + date(item.create_time) }),
    el("div", { class: "card-foot" }, [badge, el("span", { class: "card-id mono", text: item.dispute_id })])
  ]));
}

function renderBoard() {
  renderStats();
  const cols = STAGES.map((s) => {
    const items = state.items.filter((i) => stageOf(statusOf(i)) === s.key)
      .sort((a, b) => new Date(a.seller_response_due_date || 8.64e15) - new Date(b.seller_response_due_date || 8.64e15));
    return el("section", { class: "col", "aria-label": s.label }, [
      el("div", { class: "col-head" }, [
        el("span", { class: "col-dot " + s.dot }),
        s.label,
        el("span", { class: "count", text: String(items.length) })
      ]),
      items.length
        ? el("ul", { class: "col-list" }, items.map(caseCard))
        : el("p", { class: "col-empty", text: s.empty })
    ]);
  });
  $("board").replaceChildren(...cols);
  const real = state.items.filter((i) => !i.sample).length;
  const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  $("board-sub").textContent = (state.mode && state.mode.paypal
    ? real + (real === 1 ? " dispute" : " disputes") + " from your PayPal " + state.mode.env + " account, plus 3 sample cases"
    : "3 sample cases. Connect PayPal to see your own disputes") + " · updated " + time;
}

async function loadInbox() {
  const btn = $("refresh");
  btn.disabled = true;
  try {
    const data = await api("/api/disputes");
    state.mode = data.mode;
    state.items = data.items;
    renderStatus();
    const warn = $("inbox-warning");
    warn.hidden = !data.warning;
    warn.textContent = data.warning || "";
    renderBoard();
  } catch (e) {
    $("board").replaceChildren(el("div", { class: "result bad", text: e.message }));
    $("board-sub").textContent = "Couldn't load disputes";
  } finally {
    btn.disabled = false;
  }
}

function showBoard() {
  state.currentId = null;
  state.run++;
  $("case-view").hidden = true;
  $("board-view").hidden = false;
  $("nav-disputes").setAttribute("aria-current", "page");
  renderBoard();
  window.scrollTo(0, 0);
}

// ============ case page ============

async function openCase(id) {
  state.currentId = id;
  state.run++;
  $("board-view").hidden = true;
  const view = $("case-view");
  view.hidden = false;
  view.replaceChildren(el("p", { class: "empty", text: "Opening case..." }));
  window.scrollTo(0, 0);
  try {
    const data = await api("/api/disputes?id=" + encodeURIComponent(id));
    if (state.currentId !== id) return;
    state.caseData = data;
    if (data.mode) state.mode = data.mode;
    renderCase();
    $("main").focus({ preventScroll: true });
  } catch (e) {
    if (state.currentId === id) view.replaceChildren(backButton(), el("div", { class: "result bad", text: e.message }));
  }
}

function backButton() {
  return el("button", { type: "button", class: "btn btn-ghost back", onclick: showBoard }, [icon("back"), "All disputes"]);
}

function currentStatus() {
  const d = state.caseData.dispute;
  const o = state.overrides[d.dispute_id];
  return (o && o.status) || d.status;
}

function timeline() {
  const d = state.caseData.dispute;
  const stage = stageOf(currentStatus());
  const brief = state.briefs[d.dispute_id];
  const responded = stage !== "needs";
  const decided = stage === "resolved";
  const out = outcomeOf(d.dispute_id);
  const steps = [
    { title: "Dispute opened", sub: date(d.create_time), done: true },
    { title: "Investigated by Casefile", sub: brief ? VERDICTS[brief.verdict] : "Waiting for you to start", done: Boolean(brief) || responded },
    { title: "Response sent", sub: responded ? "PayPal has your response" : dueBadgeText(d.seller_response_due_date), done: responded },
    { title: "PayPal decision", sub: decided ? (out === "won" ? "Resolved in your favor" : out === "refunded" ? "Buyer refunded" : "Closed") : "Usually within 30 days of your response", done: decided }
  ];
  const firstOpen = steps.findIndex((s) => !s.done);
  return el("ol", { class: "timeline" }, steps.map((s, i) => el("li", {
    class: s.done ? "done" : i === firstOpen ? "current" : "upcoming",
    "aria-current": i === firstOpen ? "step" : null
  }, [
    el("span", { class: "t-dot" }),
    el("div", null, [el("div", { class: "t-title", text: s.title }), s.sub ? el("div", { class: "t-sub", text: s.sub }) : null])
  ])));
}
function dueBadgeText(iso) {
  const n = daysLeft(iso);
  if (n == null) return "";
  if (n < 0) return "Overdue";
  return n === 0 ? "Due today" : "Due in " + n + (n === 1 ? " day" : " days");
}

function renderCase() {
  const cd = state.caseData;
  const d = cd.dispute;
  const tx = (d.disputed_transactions || [])[0] || {};
  const buyer = (tx.buyer && tx.buyer.name) || "Buyer";
  const msgs = (d.messages || []).filter((m) => m.posted_by === "BUYER" || !m.posted_by);
  const stage = stageOf(currentStatus());
  const stageInfo = STAGES.find((s) => s.key === stage);

  let records;
  if (cd.sample) {
    records = el("pre", { class: "records", text: cd.records });
  } else {
    records = el("textarea", {
      id: "records-input", rows: "7", maxlength: "20000",
      placeholder: "USPS 9400 1118 9922 4471 0386 52: Delivered, front porch, Columbus OH, Oct 21\nEmail from buyer, Oct 23: \"Love the cedar candle...\"\nRefund policy: ..."
    });
    records.value = state.records[d.dispute_id] || "";
    records.addEventListener("input", () => { state.records[d.dispute_id] = records.value; });
  }

  const brief = state.briefs[d.dispute_id];

  $("case-view").replaceChildren(
    backButton(),
    el("header", { class: "case-head" }, [
      el("div", { class: "case-title" }, [
        el("h1", { text: REASONS[d.reason] || "Dispute" }),
        el("div", { class: "case-badges" }, [
          el("span", { class: "badge " + (stage === "needs" ? "bad" : stage === "review" ? "info" : stage === "buyer" ? "warn" : "good"), text: stageInfo.label }),
          d.dispute_life_cycle_stage ? el("span", { class: "badge", text: LIFECYCLE[d.dispute_life_cycle_stage] || d.dispute_life_cycle_stage }) : null,
          cd.sample ? el("span", { class: "badge", text: "Sample case" }) : null
        ])
      ]),
      el("div", { class: "case-money" }, [
        el("div", { class: "amount mono", text: money(d.dispute_amount) }),
        el("div", { class: "sub", text: buyer + (stage === "needs" ? " · " + dueBadgeText(d.seller_response_due_date) : "") })
      ])
    ]),
    cd.sample ? el("p", { class: "notice notice-info", text: "Sample case with invented data. The investigation runs for real; your decision is simulated and nothing is sent to PayPal." }) : null,
    el("div", { class: "case-grid" }, [
      el("div", { class: "case-main" }, [
        el("section", { class: "box" }, [
          el("div", { class: "box-head" }, el("h2", { text: "What the buyer says" })),
          msgs.length
            ? el("div", null, msgs.map((m) => el("div", { class: "quote" }, [
                el("div", { class: "quote-who", text: buyer + " · " + date(m.time_posted) }),
                el("p", { text: m.content || "" })
              ])))
            : el("p", { class: "empty", text: d.dispute_channel === "EXTERNAL" ? "No message. The buyer opened this through their card issuer." : "The buyer hasn't written anything." })
        ]),
        el("section", { class: "box" }, [
          el("div", { class: "box-head" }, el("h2", null, cd.sample ? "Your records" : el("label", { for: "records-input", text: "Your records" }))),
          el("p", { class: "box-hint", text: cd.sample
            ? "On a real case you paste these in: tracking events, emails with the buyer, your policies."
            : "Paste tracking events, emails or chats with the buyer, your shipping and refund policy, and past orders from this customer. The agent only uses what you give it." }),
          records
        ]),
        el("section", { class: "box" }, [
          el("div", { class: "box-head" }, [
            el("h2", { text: "Investigation" }),
            el("button", { type: "button", class: "btn " + (brief ? "btn-secondary" : "btn-primary"), id: "investigate", onclick: investigate },
              brief ? "Investigate again" : "Investigate case")
          ]),
          el("p", { class: "box-hint", id: "feed-hint", hidden: Boolean(brief), text: "Casefile reads the dispute, the PayPal order and your records, then recommends what to do. Nothing is sent until you approve." }),
          el("ul", { class: "feed", id: "feed" }, brief && brief._trace ? brief._trace.map(feedItem) : [])
        ]),
        el("div", { id: "brief", class: "case-main" })
      ]),
      el("aside", { class: "case-side" }, [
        el("section", { class: "box" }, [
          el("div", { class: "box-head" }, el("h2", { text: "Progress" })),
          timeline()
        ]),
        el("section", { class: "box" }, [
          el("div", { class: "box-head" }, el("h2", { text: "Case details" })),
          el("dl", { class: "details" }, [
            ["Dispute ID", el("span", { class: "mono", text: d.dispute_id })],
            ["Opened", date(d.create_time)],
            ["Buyer", buyer],
            ["Amount", money(d.dispute_amount)],
            ["Stage", LIFECYCLE[d.dispute_life_cycle_stage] || "Not listed"],
            ["Filed through", CHANNEL[d.dispute_channel] || "Not listed"],
            ["Transaction", tx.seller_transaction_id ? el("span", { class: "mono", text: tx.seller_transaction_id }) : "Not listed"]
          ].flatMap(([k, v]) => [el("dt", { text: k }), el("dd", null, v)]))
        ])
      ])
    ])
  );
  if (brief) renderBrief(brief);
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

async function investigate() {
  const id = state.currentId;
  const run = ++state.run;
  const live = () => state.run === run && state.currentId === id;
  const btn = $("investigate");
  btn.disabled = true;
  btn.textContent = "Investigating...";
  $("feed-hint").hidden = true;
  $("feed").replaceChildren();
  $("brief").replaceChildren();
  delete state.briefs[id];
  const records = state.caseData.sample ? "" : (state.records[id] || "");
  const started = Date.now();
  const trace = [];
  const add = (item) => { trace.push(item); $("feed").append(feedItem(item)); };

  let messages = null;
  let sig = null;
  try {
    for (let turn = 0; turn < 8; turn++) {
      const working = feedItem({ kind: "working", text: turn === 0 ? "Reading the case..." : "Weighing the evidence..." });
      $("feed").append(working);
      let step;
      try {
        step = await api("/api/agent", { method: "POST", body: { dispute_id: id, records, messages, sig } });
      } finally {
        working.remove();
      }
      if (!live()) return;
      step.trace.forEach(add);
      if (step.done) {
        add({ kind: "note", text: "Finished in " + Math.round((Date.now() - started) / 1000) + " seconds." });
        const brief = step.brief;
        brief._trace = trace;
        state.briefs[id] = brief;
        delete state.results[id];
        renderCase();
        const v = document.querySelector(".verdict");
        if (v) v.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      messages = step.messages;
      sig = step.sig;
    }
    throw new Error("The investigation took too many steps. Try again.");
  } catch (e) {
    if (live()) add({ kind: "note", error: true, text: e.message });
  } finally {
    if (live()) {
      btn.disabled = false;
      btn.textContent = state.briefs[id] ? "Investigate again" : "Try again";
    }
  }
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

function meter(conf) {
  const n = { LOW: 1, MEDIUM: 2, HIGH: 3 }[conf] || 1;
  return el("div", { class: "meter" }, [
    el("div", { class: "meter-bars", "aria-hidden": "true" }, [1, 2, 3].map((i) => el("span", { class: i <= n ? "on" : "" }))),
    conf.charAt(0) + conf.slice(1).toLowerCase() + " confidence"
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
  noteBox.addEventListener("input", () => { b.response_note = noteBox.value; });
  const buyerBox = el("textarea", { id: "buyer-msg", rows: "4", maxlength: "2000" });
  buyerBox.value = b.buyer_message;
  buyerBox.addEventListener("input", () => { b.buyer_message = buyerBox.value; });
  const offerInput = el("input", { type: "text", id: "offer", inputmode: "decimal", value: b.offer_amount || "" });
  offerInput.addEventListener("input", () => { b.offer_amount = offerInput.value; });

  if (!b._chosen) b._chosen = b.evidence.map(() => true);
  const chosen = () => b.evidence.filter((e, i) => b._chosen[i]);

  async function act(action, extra, title, body, okLabel) {
    if (!(await confirmStep(title, body, okLabel))) return;
    document.querySelectorAll("#brief button").forEach((x) => { x.disabled = true; });
    try {
      const r = await api("/api/act", { method: "POST", body: Object.assign({ dispute_id: id, action }, extra) });
      state.results[id] = { ok: true, text: r.message };
      if (r.sample) {
        const next = {
          provide_evidence: { status: "UNDER_REVIEW" },
          make_offer: { status: "WAITING_FOR_BUYER_RESPONSE" },
          accept_claim: { status: "RESOLVED", outcome: "refunded" },
          adjudicate: extra.outcome === "SELLER_FAVOR" ? { status: "RESOLVED", outcome: "won" } : { status: "RESOLVED", outcome: "refunded" }
        }[action];
        if (next) state.overrides[id] = next;
      } else if (r.dispute) {
        if (r.dispute.status) cd.dispute.status = r.dispute.status;
        if (r.dispute.actions) cd.actions = r.dispute.actions;
        const item = state.items.find((i) => i.dispute_id === id);
        if (item && r.dispute.status) item.status = r.dispute.status;
      }
      if (!r.sample) loadInbox();
    } catch (e) {
      state.results[id] = { ok: false, text: e.message + (e.debugId ? " (PayPal debug ID " + e.debugId + ")" : "") };
    }
    if (state.currentId === id) renderCase();
  }

  const DEFS = {
    provide_evidence: ["Submit evidence to PayPal", () => act("provide_evidence",
      { response_note: noteBox.value, evidence: chosen() },
      "Send your response to PayPal?",
      "PayPal will receive your written response and " + chosen().length + " evidence item" + (chosen().length === 1 ? "" : "s") + ". You can't edit them after sending.",
      "Send to PayPal")],
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
  const button = (action, cls) => el("button", { type: "button", class: "btn " + cls, onclick: DEFS[action][1] }, DEFS[action][0]);
  const others = Object.keys(DEFS).filter((a) => a !== primary && allowed.has(a));

  const result = state.results[id];
  const showSim = stage === "review" && ((cd.sample) || (cd.mode && cd.mode.env === "sandbox" && allowed.has("adjudicate")));
  const sim = showSim ? el("div", { class: "sandbox-tools" }, [
    el("p", { text: cd.sample ? "Sample case: play PayPal's reviewer to finish the story." : "Sandbox only: play PayPal's reviewer to finish the demo." }),
    el("div", { class: "decide" }, [
      el("button", { type: "button", class: "btn btn-secondary", onclick: () => act("adjudicate", { outcome: "SELLER_FAVOR" }, "Simulate PayPal ruling for you?", "This uses PayPal's sandbox tool to close the case in your favor.", "Simulate") }, "Simulate: you win"),
      el("button", { type: "button", class: "btn btn-secondary", onclick: () => act("adjudicate", { outcome: "BUYER_FAVOR" }, "Simulate PayPal ruling for the buyer?", "This uses PayPal's sandbox tool to close the case in the buyer's favor.", "Simulate") }, "Simulate: buyer wins")
    ])
  ]) : null;

  $("brief").replaceChildren(
    el("section", { class: "verdict " + b.verdict }, [
      el("div", { class: "verdict-top" }, [el("span", { class: "verdict-label", text: "Recommendation" }), meter(b.confidence)]),
      el("div", { class: "verdict-call", text: VERDICTS[b.verdict] }),
      el("p", { class: "verdict-headline", text: b.headline }),
      el("p", { class: "verdict-reasoning", text: b.reasoning }),
      open && allowed.has(primary) ? el("div", { class: "verdict-actions" }, button(primary, "btn-primary btn-lg")) : null,
      open && allowed.has(primary) ? el("p", { class: "box-hint", text: "Review the response and evidence below first. You'll confirm before anything is sent." }) : null
    ]),
    b.key_facts.length ? el("section", { class: "box" }, [
      el("div", { class: "box-head" }, el("h2", { text: "Facts the agent relied on" })),
      el("ul", { class: "facts" }, b.key_facts.map((f) => {
        const [label, tone] = SOURCES[f.source] || [f.source, ""];
        return el("li", null, [el("span", { class: "badge " + tone, text: label }), el("span", { text: f.fact })]);
      }))
    ]) : null,
    b.evidence.length ? el("section", { class: "box" }, [
      el("div", { class: "box-head" }, [
        el("h2", { text: "Evidence to send" }),
        el("span", { class: "badge", id: "ev-count", text: chosen().length + " of " + b.evidence.length + " selected" })
      ]),
      el("div", { class: "evidence" }, b.evidence.map((e, i) => {
        const box = el("input", { type: "checkbox", id: "ev-" + i, checked: b._chosen[i] });
        box.addEventListener("change", () => {
          b._chosen[i] = box.checked;
          $("ev-count").textContent = chosen().length + " of " + b.evidence.length + " selected";
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
    b.gaps.length ? el("section", { class: "box" }, [
      el("div", { class: "box-head" }, el("h2", { text: "What would make this case stronger" })),
      el("ul", { class: "gaps" }, b.gaps.map((g) => el("li", { text: g })))
    ]) : null,
    el("section", { class: "box" }, [
      el("div", { class: "box-head" }, el("h2", { text: "Your decision" })),
      open
        ? el("div", { class: "decide" }, [
            allowed.has(primary) ? button(primary, "btn-primary") : null,
            ...others.map((a) => button(a, "btn-secondary"))
          ])
        : el("p", { class: "empty", text: stage === "resolved" ? "This case is closed." : "Your response is with PayPal. Nothing else to do until they decide." }),
      result ? el("div", { class: "result " + (result.ok ? "ok" : "bad"), text: result.text }) : null,
      sim
    ])
  );
}

// ============ start ============

// The access code screen can't be dismissed: without a code nothing loads.
$("access-dialog").addEventListener("cancel", (e) => e.preventDefault());
$("refresh").addEventListener("click", loadInbox);
$("nav-disputes").addEventListener("click", showBoard);
$("brand-link").addEventListener("click", (e) => { e.preventDefault(); showBoard(); });
loadInbox();
