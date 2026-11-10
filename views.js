"use strict";

// Pages, navigation and the dashboard. Builds on the helpers and case page in app.js.

const ROUTE_TITLES = {
  overview: "Overview", disputes: "All disputes", investigations: "AI investigations", radar: "Deadline Radar",
  vault: "Evidence Vault", analytics: "Analytics", risk: "Risk Monitor", history: "Case history",
  integrations: "Integrations", team: "Team members", preferences: "Preferences", roadmap: "Roadmap"
};

// ---------- shared data helpers (used by notify.js too) ----------

// The cases the app works with: real disputes OR sample cases, never both, so invented money
// never mixes with real figures. By default real disputes win when there are any; the switch
// in the top bar ("Your disputes | Sample cases") lets the seller pick.
function workPool() {
  const real = state.items.filter((i) => !i.sample);
  const samples = state.items.filter((i) => i.sample);
  const choice = Store.prefs().dataset;
  const useSamples = !real.length || choice === "sample";
  return { items: useSamples ? samples : real, sampleOnly: useSamples, hasBoth: real.length > 0 && samples.length > 0 };
}
function amountOf(item) {
  return item.dispute_amount && item.dispute_amount.value ? Number(item.dispute_amount.value) : 0;
}

// ---------- routing ----------

function setRoute(route) {
  if (location.hash !== "#" + route) location.hash = route;
}
function showPage(id) {
  document.querySelectorAll("#main > .page").forEach((p) => { p.hidden = p.id !== id; });
}

async function loadInbox() {
  document.querySelectorAll("[data-refresh]").forEach((b) => { b.disabled = true; });
  try {
    const data = await api("/api/disputes");
    state.mode = data.mode;
    state.items = data.items;
    Views.renderStatus();
    const warn = $("inbox-warning");
    warn.hidden = !data.warning;
    warn.textContent = data.warning || "";
    Views.renderAll();
    Notify.sync();
  } catch (e) {
    $("overview-sub").textContent = "Couldn't load disputes: " + e.message;
    $("disputes-sub").textContent = "Couldn't load disputes: " + e.message;
  } finally {
    document.querySelectorAll("[data-refresh]").forEach((b) => { b.disabled = false; });
  }
}

const Views = (() => {
  // ---------- priority ----------
  const LEVEL_RANK = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  const LEVEL_TONE = { Critical: "bad", High: "warn", Medium: "info", Low: "" };
  const NEXT_ACTION = {
    "Open": "Start the investigation",
    "Under investigation": "Investigation running",
    "Awaiting approval": "Review and approve the response",
    "Ready for submission": "Send the response to PayPal",
    "Submitted": "Wait for PayPal's decision",
    "Awaiting buyer": "Wait for the buyer's reply"
  };

  // Rules the seller can see, not a hidden score: deadline first, then money, stage, evidence and approval.
  function priorityOf(item, maxAmount) {
    const stage = stageOf(statusOf(item));
    if (stage === "resolved") return null;
    const wf = workflowOf(item);
    const reasons = [];
    let level;
    let action = NEXT_ACTION[wf] || "Open the case";
    if (stage !== "needs") {
      level = "Low";
      reasons.push({ text: stage === "review" ? "Submitted, PayPal reviewing" : "Waiting on the buyer", tone: "info" });
    } else {
      const h = hoursLeft(item.seller_response_due_date);
      const share = maxAmount > 0 ? amountOf(item) / maxAmount : 0;
      if (h != null && h < 0) {
        level = "Critical";
        action = "Deadline passed: check the case in PayPal";
        reasons.push({ text: "Deadline passed", tone: "bad" });
      } else if (h != null && h < 24) {
        level = "Critical";
        reasons.push({ text: "Under 24 hours left", tone: "bad" });
      } else if (h != null && h < 72) {
        level = "High";
        reasons.push({ text: "Due within 3 days", tone: "bad" });
      } else if (h != null && h < 168 && share >= 0.5) {
        level = "High";
        reasons.push({ text: "Due this week", tone: "warn" });
      } else {
        level = "Medium";
        if (h != null) reasons.push({ text: h < 168 ? "Due this week" : "Over a week left", tone: h < 168 ? "warn" : "" });
        else reasons.push({ text: "No deadline listed", tone: "" });
      }
      if (maxAmount > 0 && share === 1) reasons.push({ text: "Largest amount at risk", tone: "" });
      if (item.dispute_life_cycle_stage === "CHARGEBACK" || item.dispute_life_cycle_stage === "PRE_ARBITRATION" || item.dispute_life_cycle_stage === "ARBITRATION") {
        reasons.push({ text: (LIFECYCLE[item.dispute_life_cycle_stage] || "") + ": money already held", tone: "warn" });
      }
      const b = state.briefs[item.dispute_id];
      if (wf === "Awaiting approval") reasons.push({ text: "Waiting for your approval", tone: "warn" });
      if (wf === "Ready for submission") reasons.push({ text: "Approved, not sent yet", tone: "info" });
      const gapCount = b ? (Array.isArray(b.missing) ? b.missing.length : (b.gaps || []).length) : 0;
      if (gapCount) reasons.push({ text: gapCount + " evidence gap" + (gapCount === 1 ? "" : "s"), tone: "" });
      if (!b && !item.sample && !state.records[item.dispute_id]) reasons.push({ text: "No records added yet", tone: "" });
    }
    const h = hoursLeft(item.seller_response_due_date);
    return { level, reasons, action, wf, sortKey: [LEVEL_RANK[level], h == null ? 1e9 : h, -amountOf(item)] };
  }
  function byPriority(a, b) {
    for (let i = 0; i < 3; i++) if (a.p.sortKey[i] !== b.p.sortKey[i]) return a.p.sortKey[i] - b.p.sortKey[i];
    return 0;
  }
  function rankedOpen(items) {
    const active = items.filter((i) => stageOf(statusOf(i)) !== "resolved");
    const needsMax = Math.max(0, ...active.filter((i) => stageOf(statusOf(i)) === "needs").map(amountOf));
    return active.map((item) => ({ item, p: priorityOf(item, needsMax) })).sort(byPriority);
  }

  // ---------- sidebar ----------

  function renderStatus() {
    const m = state.mode;
    if (m) {
      $("status").replaceChildren(
        el("span", { class: "conn" + (m.paypal ? " on" : "") }, [el("span", { class: "nav-text" }, m.paypal ? "PayPal " + m.env + " connected" : "PayPal not connected")]),
        el("span", { class: "conn" + (m.ai ? " on" : "") }, [el("span", { class: "nav-text" }, m.ai ? "AI agent ready" : "AI not connected")])
      );
      $("store-link").hidden = !(m.paypal && m.env === "sandbox");
    }
    const p = Store.prefs();
    // The "Your disputes | Sample cases" switch only appears when there are both.
    const pool = workPool();
    $("dataset-seg").hidden = !pool.hasBoth;
    document.querySelectorAll("#dataset-seg button").forEach((b) => {
      b.setAttribute("aria-pressed", (b.dataset.dataset === "sample") === pool.sampleOnly ? "true" : "false");
    });
    const name = p.storeName.trim() || "Your store";
    $("profile-name").textContent = name;
    $("avatar").textContent = name.charAt(0).toUpperCase();
    $("avatar-top").textContent = name.charAt(0).toUpperCase();
  }

  function renderCounts() {
    const { items } = workPool();
    const active = items.filter((i) => stageOf(statusOf(i)) !== "resolved");
    const urgent = items.filter((i) => stageOf(statusOf(i)) === "needs" && urgencyOf(i.seller_response_due_date) !== "upcoming" && urgencyOf(i.seller_response_due_date) !== "none");
    const investigated = state.items.filter((i) => state.briefs[i.dispute_id]).length;
    $("count-disputes").textContent = active.length ? String(active.length) : "";
    $("count-investigations").textContent = investigated ? String(investigated) : "";
    $("count-radar").textContent = urgent.length ? String(urgent.length) : "";
  }

  function markNav(route) {
    document.querySelectorAll(".nav-item[data-route]").forEach((a) => {
      if (a.dataset.route === route) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  // ---------- overview: stats ----------

  function sumByCurrency(list) {
    const cents = {};
    for (const i of list) {
      const m = i.dispute_amount;
      if (m && m.value) cents[m.currency_code] = (cents[m.currency_code] || 0) + Math.round(Number(m.value) * 100);
    }
    const cur = Object.keys(cents).sort((a, b) => cents[b] - cents[a])[0] || "USD";
    return { cur, value: (cents[cur] || 0) / 100, mixed: Object.keys(cents).length > 1 };
  }
  function fmt(cur, value) { return money({ currency_code: cur, value: value.toFixed(2) }); }

  function stat(label, value, foot, tone, extra) {
    return el("div", { class: "stat" + (tone ? " stat-" + tone : "") }, [
      el("span", { class: "stat-label", text: label }),
      el("span", { class: "stat-value mono", text: value }),
      el("span", { class: "stat-foot" }, foot),
      extra || null
    ]);
  }

  function renderStats() {
    const { items, sampleOnly } = workPool();
    const tag = sampleOnly ? el("span", { class: "sample-tag", text: "Sample data" }) : null;
    const active = items.filter((i) => stageOf(statusOf(i)) !== "resolved");
    const needs = items.filter((i) => stageOf(statusOf(i)) === "needs");
    const resolved = items.filter((i) => stageOf(statusOf(i)) === "resolved");
    const won = resolved.filter((i) => outcomeOf(i.dispute_id) === "won");
    const pending = items.filter((i) => stageOf(statusOf(i)) === "review");

    // 1. Money at risk, with the change in newly disputed money versus the previous 30 days.
    const risk = sumByCurrency(active);
    const now = Date.now();
    const inWindow = (i, from, to) => { const t = new Date(i.create_time).getTime(); return t >= from && t < to; };
    const cur30 = sumByCurrency(items.filter((i) => inWindow(i, now - 30 * 86400000, now))).value;
    const prev30 = sumByCurrency(items.filter((i) => inWindow(i, now - 60 * 86400000, now - 30 * 86400000))).value;
    let change = null;
    if (cur30 || prev30) {
      const diff = cur30 - prev30;
      change = el("span", { class: "delta " + (diff > 0 ? "up" : diff < 0 ? "down" : "") },
        diff === 0 ? "Same new disputes as the previous 30 days"
          : (diff > 0 ? "▲ " : "▼ ") + fmt(risk.cur, Math.abs(diff)) + (diff > 0 ? " more" : " less") + " disputed than the previous 30 days");
    }

    // 2. Active disputes by status.
    const byStatus = {};
    active.forEach((i) => { const s = workflowOf(i); byStatus[s] = (byStatus[s] || 0) + 1; });
    const breakdown = Object.entries(byStatus).map(([s, n]) => n + " " + s.toLowerCase()).join(" · ");

    // 3. Needs attention, with urgent ones called out.
    const urgent = needs.filter((i) => { const h = hoursLeft(i.seller_response_due_date); return h != null && h < 72; });

    // 4. Money protected: confirmed wins, with money still awaiting PayPal shown separately.
    const protectedSum = sumByCurrency(won);
    const pendingSum = sumByCurrency(pending);

    // 5. Win rate from actual outcomes. 6. Average days from opening to resolution.
    const rate = resolved.length ? Math.round((won.length / resolved.length) * 100) : null;
    const times = resolved.map((i) => (new Date(i.resolved_time || i.update_time) - new Date(i.create_time)) / 86400000).filter((d) => isFinite(d) && d >= 0);
    const avg = times.length ? times.reduce((s, d) => s + d, 0) / times.length : null;

    $("stats").replaceChildren(
      stat("Money at risk", fmt(risk.cur, risk.value), [
        active.length + " active case" + (active.length === 1 ? "" : "s") + (risk.mixed ? ", plus other currencies" : ""),
        change ? el("br") : null, change, tag
      ]),
      stat("Active disputes", String(active.length), [breakdown || "None open", tag]),
      stat("Needs attention", String(needs.length), [
        urgent.length ? el("span", { class: "urgent-text", text: urgent.length + " urgent, due within 3 days" }) : (needs.length ? "Nothing due within 3 days" : "Nothing waiting on you"),
        tag
      ], urgent.length ? "alert" : ""),
      stat("Money protected", fmt(protectedSum.cur, protectedSum.value), [
        "Confirmed from " + won.length + " won case" + (won.length === 1 ? "" : "s"),
        pending.length ? el("br") : null,
        pending.length ? fmt(pendingSum.cur, pendingSum.value) + " pending PayPal's decision" : null,
        tag
      ], "good"),
      stat("Win rate", rate == null ? "No data" : rate + "%", [
        resolved.length ? won.length + " won of " + resolved.length + " resolved" : "No resolved cases yet",
        tag
      ]),
      stat("Avg. resolution time", avg == null ? "No data" : (avg < 10 ? avg.toFixed(1) : Math.round(avg)) + " days", [
        times.length ? "Across " + times.length + " resolved case" + (times.length === 1 ? "" : "s") + (sampleOnly ? "" : ", using PayPal's last update date") : "No resolved cases yet",
        tag
      ])
    );
  }

  // ---------- overview: attention queue ----------

  function queueRow(item, p) {
    const due = item.seller_response_due_date;
    const stage = stageOf(statusOf(item));
    return el("li", { class: "aq-row" }, [
      el("span", { class: "badge aq-level " + LEVEL_TONE[p.level], text: p.level }),
      el("div", { class: "aq-who" }, [
        el("span", { class: "aq-name" }, [item.buyer_name || "Customer not listed", item.sample ? el("span", { class: "badge", text: "Sample" }) : null]),
        el("span", { class: "aq-sub" }, [el("span", { class: "mono", text: item.dispute_id }), " · " + (REASONS[item.reason] || "Dispute")])
      ]),
      el("span", { class: "aq-amount mono", text: money(item.dispute_amount) }),
      el("div", { class: "aq-due" }, stage === "needs" && due
        ? [el("span", { class: "aq-date", text: dateTime(due) }), countdownEl(due)]
        : [el("span", { class: "aq-date muted", text: stage === "needs" ? "No deadline listed" : "Response sent" })]),
      el("span", { class: "badge aq-status " + STATUS_TONE[p.wf], text: p.wf }),
      el("div", { class: "aq-next" }, [el("span", { class: "aq-next-label", text: "Next" }), el("span", { text: p.action })]),
      el("button", { type: "button", class: "btn btn-secondary btn-sm aq-btn", onclick: () => openCase(item.dispute_id), "aria-label": "Open case " + item.dispute_id }, "Open case")
    ]);
  }

  function renderQueue() {
    const { items } = workPool();
    const ranked = rankedOpen(items);
    const now = ranked.filter((r) => r.p.level !== "Low");
    const monitored = ranked.filter((r) => r.p.level === "Low");
    const box = $("queue");
    const parts = [];
    if (now.length) {
      parts.push(el("ol", { class: "aq" }, now.map((r) => queueRow(r.item, r.p))));
    } else {
      parts.push(el("p", { class: "empty-state", text: "Nothing needs your attention right now. New disputes from PayPal are ranked here as they arrive." }));
    }
    if (monitored.length) {
      const det = el("details", { class: "aq-monitored" }, [
        el("summary", { text: "Being monitored (" + monitored.length + "): waiting on PayPal or the buyer" }),
        el("ol", { class: "aq" }, monitored.map((r) => queueRow(r.item, r.p)))
      ]);
      parts.push(det);
    }
    box.replaceChildren(...parts);
  }

  // ---------- overview: coming deadlines (compact) ----------

  function renderRadarMini() {
    const { items } = workPool();
    const upcoming = items.filter((i) => stageOf(statusOf(i)) === "needs" && i.seller_response_due_date)
      .sort((a, b) => new Date(a.seller_response_due_date) - new Date(b.seller_response_due_date));
    const box = $("radar-mini");
    if (!upcoming.length) {
      box.replaceChildren(el("p", { class: "empty-state", text: "No response deadlines coming up." }));
      return;
    }
    const counts = { critical: 0, warning: 0, upcoming: 0 };
    upcoming.forEach((i) => { const u = urgencyOf(i.seller_response_due_date); if (counts[u] != null) counts[u]++; });
    box.replaceChildren(
      el("div", { class: "mini-counts" }, [
        el("span", { class: "badge bad", text: counts.critical + " critical" }),
        el("span", { class: "badge warn", text: counts.warning + " warning" }),
        el("span", { class: "badge", text: counts.upcoming + " upcoming" })
      ]),
      el("ul", { class: "mini-list" }, upcoming.slice(0, 5).map((i) => el("li", null, el("button", {
        type: "button", class: "mini-row", onclick: () => openCase(i.dispute_id)
      }, [
        el("span", { class: "mini-who" }, [el("span", { class: "mini-name", text: i.buyer_name || i.dispute_id }), el("span", { class: "mini-date", text: dateTime(i.seller_response_due_date) })]),
        countdownEl(i.seller_response_due_date)
      ]))))
    );
  }

  // ---------- overview: financial charts ----------

  let range = "90d";
  let showTable = false;
  const SERIES = [
    { key: "disputed", label: "Disputed", cls: "s1" },
    { key: "refunded", label: "Refunded or lost", cls: "s2" },
    { key: "recovered", label: "Recovered", cls: "s3" }
  ];

  function buckets(r) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const out = [];
    if (r === "12m") {
      for (let i = 11; i >= 0; i--) {
        const s = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const e = new Date(s.getFullYear(), s.getMonth() + 1, 1);
        out.push({ start: s, end: e, label: s.toLocaleDateString("en-US", { month: "short" }), long: s.toLocaleDateString("en-US", { month: "long", year: "numeric" }) });
      }
      return out;
    }
    const [n, days] = { "7d": [7, 1], "30d": [10, 3], "90d": [13, 7] }[r];
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    for (let i = n - 1; i >= 0; i--) {
      const e = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i * days);
      const s = new Date(e.getFullYear(), e.getMonth(), e.getDate() - days);
      const last = new Date(e.getFullYear(), e.getMonth(), e.getDate() - 1);
      const short = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      out.push({ start: s, end: e, label: short(s), long: days === 1 ? s.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : short(s) + " to " + short(last) });
    }
    return out;
  }

  function seriesData(items, bs) {
    const rows = bs.map((b) => ({ b, disputed: 0, refunded: 0, recovered: 0, count: 0 }));
    const find = (t) => { const ms = new Date(t).getTime(); return rows.find((r) => ms >= r.b.start.getTime() && ms < r.b.end.getTime()); };
    for (const i of items) {
      const amt = amountOf(i);
      const opened = i.create_time && find(i.create_time);
      if (opened) { opened.disputed += amt; opened.count += 1; }
      if (stageOf(statusOf(i)) === "resolved") {
        const when = i.resolved_time || i.update_time;
        const row = when && find(when);
        const out = outcomeOf(i.dispute_id);
        if (row && out === "won") row.recovered += amt;
        if (row && (out === "lost" || out === "refunded")) row.refunded += amt;
      }
    }
    return rows;
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    const exp = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / exp;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
  }
  function short$(v, cur) {
    const sym = money({ currency_code: cur, value: "0" }).replace(/[\d.,\s]/g, "") || "$";
    if (v >= 1000) return sym + (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k";
    return sym + Math.round(v);
  }
  function svgEl(tag, attrs, children) {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, String(v));
    for (const c of [].concat(children || [])) if (c) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }
  // Bars with 4px rounded tops, anchored square on the baseline.
  function barPath(x, y, w, h) {
    const r = Math.min(4, w / 2, h);
    return "M" + x + "," + (y + h) + "V" + (y + r) + "Q" + x + "," + y + " " + (x + r) + "," + y +
      "H" + (x + w - r) + "Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + r) + "V" + (y + h) + "Z";
  }

  function showTip(evt, row, cur) {
    const tip = $("tooltip");
    tip.replaceChildren(
      el("strong", { text: row.b.long }),
      ...SERIES.map((s) => el("span", { class: "tip-row" }, [el("span", { class: "swatch " + s.cls }), s.label + ": ", el("b", { text: fmt(cur, row[s.key]) })])),
      el("span", { class: "tip-row" }, [el("span", { class: "swatch s-vol" }), "New disputes: ", el("b", { text: String(row.count) })])
    );
    tip.hidden = false;
    let x, y;
    if (evt.type === "focus") {
      const r = evt.target.getBoundingClientRect();
      x = r.left + r.width / 2; y = r.top;
    } else { x = evt.clientX; y = evt.clientY; }
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x + 14)) + "px";
    tip.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, y - h - 10)) + "px";
  }
  function hideTip() { $("tooltip").hidden = true; }

  function renderFinance() {
    const { items, sampleOnly } = workPool();
    const host = $("finance");
    const bs = buckets(range);
    const rows = seriesData(items, bs);
    const cur = sumByCurrency(items).cur;
    const totals = SERIES.map((s) => rows.reduce((t, r) => t + r[s.key], 0));
    const totalCount = rows.reduce((t, r) => t + r.count, 0);

    const legend = el("div", { class: "chart-legend" }, [
      ...SERIES.map((s, i) => el("span", { class: "leg" }, [el("span", { class: "swatch " + s.cls }), s.label, el("b", { class: "mono", text: fmt(cur, totals[i]) })])),
      el("span", { class: "leg" }, [el("span", { class: "swatch s-vol" }), "New disputes", el("b", { class: "mono", text: String(totalCount) })]),
      sampleOnly ? el("span", { class: "sample-tag", text: "Sample data" }) : null
    ]);

    const width = Math.max(320, Math.floor(host.clientWidth || 640));
    const M = { l: 48, r: 8, t: 10, b: 24 };
    const plotW = width - M.l - M.r;
    const groupW = plotW / rows.length;
    const labelEvery = Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor(plotW / 58))));

    // Money chart: grouped bars, one axis.
    const H = 210;
    const plotH = H - M.t - M.b;
    const maxV = niceMax(Math.max(0, ...rows.map((r) => Math.max(r.disputed, r.refunded, r.recovered))));
    const y = (v) => M.t + plotH - (v / maxV) * plotH;
    const money$ = svgEl("svg", { viewBox: "0 0 " + width + " " + H, width, height: H, class: "chart", role: "img", "aria-label": "Money disputed, refunded and recovered per period" });
    for (let k = 0; k <= 4; k++) {
      const v = (maxV / 4) * k;
      money$.append(svgEl("line", { x1: M.l, x2: width - M.r, y1: y(v), y2: y(v), class: k === 0 ? "axis" : "grid" }));
      money$.append(svgEl("text", { x: M.l - 6, y: y(v) + 4, class: "tick", "text-anchor": "end" }, short$(v, cur)));
    }
    const inner = groupW * 0.72;
    const barW = Math.max(2, (inner - 4) / 3);
    rows.forEach((r, gi) => {
      const gx = M.l + gi * groupW + (groupW - inner) / 2;
      SERIES.forEach((s, si) => {
        const v = r[s.key];
        if (v <= 0) return;
        const h = Math.max(1, (v / maxV) * plotH);
        money$.append(svgEl("path", { d: barPath(gx + si * (barW + 2), M.t + plotH - h, barW, h), class: "bar " + s.cls }));
      });
      if (gi % labelEvery === 0) {
        money$.append(svgEl("text", { x: M.l + gi * groupW + groupW / 2, y: H - 6, class: "tick", "text-anchor": "middle" }, r.b.label));
      }
    });

    // Volume chart: its own axis, same time scale below the money chart.
    const VH = 92;
    const vPlot = VH - M.t - M.b;
    const maxC = Math.max(1, ...rows.map((r) => r.count));
    const vy = (v) => M.t + vPlot - (v / maxC) * vPlot;
    const vol = svgEl("svg", { viewBox: "0 0 " + width + " " + VH, width, height: VH, class: "chart", role: "img", "aria-label": "New disputes per period" });
    vol.append(svgEl("line", { x1: M.l, x2: width - M.r, y1: vy(0), y2: vy(0), class: "axis" }));
    vol.append(svgEl("line", { x1: M.l, x2: width - M.r, y1: vy(maxC), y2: vy(maxC), class: "grid" }));
    vol.append(svgEl("text", { x: M.l - 6, y: vy(maxC) + 4, class: "tick", "text-anchor": "end" }, String(maxC)));
    vol.append(svgEl("text", { x: M.l - 6, y: vy(0) + 4, class: "tick", "text-anchor": "end" }, "0"));
    const vW = Math.max(2, Math.min(inner, 28));
    rows.forEach((r, gi) => {
      if (r.count > 0) {
        const h = Math.max(1, (r.count / maxC) * vPlot);
        vol.append(svgEl("path", { d: barPath(M.l + gi * groupW + (groupW - vW) / 2, M.t + vPlot - h, vW, h), class: "bar s-vol" }));
      }
      if (gi % labelEvery === 0) vol.append(svgEl("text", { x: M.l + gi * groupW + groupW / 2, y: VH - 6, class: "tick", "text-anchor": "middle" }, r.b.label));
    });

    // Hover and keyboard targets span both charts for each period.
    [money$, vol].forEach((svg, idx) => {
      const h = idx === 0 ? H : VH;
      rows.forEach((r, gi) => {
        const band = svgEl("rect", { x: M.l + gi * groupW, y: 0, width: groupW, height: h - M.b, class: "hit", tabindex: idx === 0 ? 0 : null, "aria-label": r.b.long + ": disputed " + fmt(cur, r.disputed) + ", refunded or lost " + fmt(cur, r.refunded) + ", recovered " + fmt(cur, r.recovered) + ", " + r.count + " new disputes" });
        band.addEventListener("mousemove", (e) => { showTip(e, r, cur); markBand(gi); });
        band.addEventListener("focus", (e) => { showTip(e, r, cur); markBand(gi); });
        band.addEventListener("mouseleave", () => { hideTip(); markBand(-1); });
        band.addEventListener("blur", () => { hideTip(); markBand(-1); });
        svg.append(band);
      });
    });
    function markBand(i) {
      host.querySelectorAll(".hit").forEach((b, k) => b.classList.toggle("on", k % rows.length === i));
    }

    const empty = rows.every((r) => !r.disputed && !r.refunded && !r.recovered && !r.count);
    const table = el("table", { class: "data-table compact", hidden: !showTable }, [
      el("thead", null, el("tr", null, ["Period", ...SERIES.map((s) => s.label), "New disputes"].map((t) => el("th", { scope: "col", text: t })))),
      el("tbody", null, rows.map((r) => el("tr", null, [
        el("th", { scope: "row", text: r.b.long }),
        ...SERIES.map((s) => el("td", { class: "mono", text: fmt(cur, r[s.key]) })),
        el("td", { class: "mono", text: String(r.count) })
      ])))
    ]);
    host.replaceChildren(...[
      legend,
      empty ? el("p", { class: "empty-state", text: "No disputes opened or resolved in this period." }) : null,
      el("div", { class: "chart-wrap", hidden: showTable }, [
        money$,
        el("p", { class: "chart-sub", text: "New disputes" }),
        vol
      ]),
      el("div", { class: "table-scroll" }, table),
      el("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => { showTable = !showTable; renderFinance(); } }, showTable ? "Show as chart" : "Show as table")
    ].filter(Boolean));
  }

  // ---------- all disputes ----------

  const filters = { q: "", status: "All", category: "", priority: "", min: "", max: "", from: "", to: "", sort: "deadline", samples: null };
  const STATUS_FILTERS = ["All", "Open", "Under investigation", "Awaiting approval", "Ready for submission", "Submitted", "Resolved", "Won", "Lost", "Refunded"];
  function statusMatches(filter, wf) {
    if (filter === "All") return true;
    if (filter === "Submitted") return wf === "Submitted" || wf === "Awaiting buyer";
    if (filter === "Under investigation") return wf === "Under investigation" || wf === "Paused";
    if (filter === "Resolved") return ["Won", "Lost", "Refunded", "Resolved"].includes(wf);
    return wf === filter;
  }

  function disputeRows() {
    const base = workPool().items;
    const needsMax = Math.max(0, ...base.filter((i) => stageOf(statusOf(i)) === "needs").map(amountOf));
    return base.map((item) => ({ item, wf: workflowOf(item), p: priorityOf(item, needsMax) }));
  }

  function applyFilters(rows) {
    const q = filters.q.trim().toLowerCase();
    const min = filters.min === "" ? null : Number(filters.min);
    const max = filters.max === "" ? null : Number(filters.max);
    const from = filters.from ? new Date(filters.from + "T00:00:00") : null;
    const to = filters.to ? new Date(filters.to + "T23:59:59") : null;
    let out = rows.filter(({ item, wf, p }) => {
      if (!statusMatches(filters.status, wf)) return false;
      if (q && ![item.buyer_name, item.dispute_id, item.order_id, item.transaction_id].some((v) => v && String(v).toLowerCase().includes(q))) return false;
      if (filters.category && item.reason !== filters.category) return false;
      if (filters.priority && (p ? p.level : "None") !== filters.priority) return false;
      const amt = amountOf(item);
      if (min != null && !isNaN(min) && amt < min) return false;
      if (max != null && !isNaN(max) && amt > max) return false;
      const opened = new Date(item.create_time);
      if (from && opened < from) return false;
      if (to && opened > to) return false;
      return true;
    });
    const t = (i) => new Date(i.create_time).getTime() || 0;
    const due = (r) => (stageOf(statusOf(r.item)) === "needs" && r.item.seller_response_due_date ? new Date(r.item.seller_response_due_date).getTime() : 8.64e15);
    const sorts = {
      newest: (a, b) => t(b.item) - t(a.item),
      oldest: (a, b) => t(a.item) - t(b.item),
      high: (a, b) => amountOf(b.item) - amountOf(a.item),
      low: (a, b) => amountOf(a.item) - amountOf(b.item),
      deadline: (a, b) => due(a) - due(b) || t(b.item) - t(a.item)
    };
    return out.sort(sorts[filters.sort] || sorts.deadline);
  }

  function buildToolbar() {
    const bar = $("toolbar");
    const search = el("input", { type: "search", id: "f-q", placeholder: "Search customer, dispute ID or order ID", "aria-label": "Search disputes", value: filters.q });
    search.addEventListener("input", () => { filters.q = search.value; renderDisputesBody(); });
    const sort = el("select", { id: "f-sort", "aria-label": "Sort" }, [
      ["deadline", "Nearest deadline"], ["newest", "Newest"], ["oldest", "Oldest"], ["high", "Highest amount"], ["low", "Lowest amount"]
    ].map(([v, t]) => el("option", { value: v, selected: filters.sort === v }, t)));
    sort.addEventListener("change", () => { filters.sort = sort.value; renderDisputesBody(); });

    const cats = el("select", { id: "f-cat", "aria-label": "Category" }, [el("option", { value: "" }, "All categories"),
      ...Object.entries(REASONS).map(([k, v]) => el("option", { value: k, selected: filters.category === k }, v))]);
    cats.addEventListener("change", () => { filters.category = cats.value; renderDisputesBody(); });
    const pri = el("select", { id: "f-pri", "aria-label": "Priority" }, [el("option", { value: "" }, "All priorities"),
      ...["Critical", "High", "Medium", "Low", "None"].map((v) => el("option", { value: v, selected: filters.priority === v }, v === "None" ? "Resolved (no priority)" : v))]);
    pri.addEventListener("change", () => { filters.priority = pri.value; renderDisputesBody(); });
    const num = (id, label, key) => {
      const i = el("input", { type: "number", id, min: "0", step: "1", inputmode: "decimal", placeholder: label, "aria-label": label, value: filters[key] });
      i.addEventListener("input", () => { filters[key] = i.value; renderDisputesBody(); });
      return i;
    };
    const day = (id, label, key) => {
      const i = el("input", { type: "date", id, "aria-label": label, value: filters[key] });
      i.addEventListener("change", () => { filters[key] = i.value; renderDisputesBody(); });
      return i;
    };
    const clear = el("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => {
      Object.assign(filters, { q: "", status: "All", category: "", priority: "", min: "", max: "", from: "", to: "", sort: "deadline" });
      buildToolbar(); renderDisputesBody();
    } }, "Clear filters");

    bar.replaceChildren(
      el("div", { class: "tb-row" }, [el("div", { class: "search" }, [icon("search"), search]), el("label", { class: "tb-field" }, [el("span", { text: "Sort" }), sort])]),
      el("div", { class: "chips", id: "status-chips", role: "group", "aria-label": "Filter by status" }),
      el("div", { class: "tb-row tb-filters" }, [
        cats, pri,
        el("span", { class: "tb-pair tb-amount" }, [num("f-min", "Min amount", "min"), el("span", { class: "muted", text: "to" }), num("f-max", "Max amount", "max")]),
        el("span", { class: "tb-pair tb-dates" }, [el("span", { class: "muted", text: "Received" }), day("f-from", "Received from", "from"), el("span", { class: "muted", text: "to" }), day("f-to", "Received to", "to")]),
        clear
      ])
    );
  }

  function renderChips(rows) {
    const counts = {};
    STATUS_FILTERS.forEach((s) => { counts[s] = rows.filter((r) => statusMatches(s, r.wf)).length; });
    $("status-chips").replaceChildren(...STATUS_FILTERS.map((s) => el("button", {
      type: "button", class: "chip", "aria-pressed": filters.status === s ? "true" : "false",
      onclick: () => { filters.status = s; renderDisputesBody(); }
    }, [s, el("span", { class: "chip-count mono", text: String(counts[s]) })])));
  }

  function renderDisputesBody() {
    const all = disputeRows();
    renderChips(all);
    const rows = applyFilters(all);
    $("disputes-sub").textContent = "Showing " + rows.length + " of " + all.length + " dispute" + (all.length === 1 ? "" : "s");
    const body = $("disputes-body");
    if (!rows.length) {
      body.replaceChildren(el("div", { class: "box empty-box" }, [
        el("p", { class: "empty-title", text: all.length ? "No disputes match these filters" : "No disputes yet" }),
        el("p", { class: "muted", text: all.length ? "Try a different status, widen the amount or date range, or clear the search." : "When PayPal sends you a dispute, it appears here." }),
        all.length ? el("button", { type: "button", class: "btn btn-secondary", onclick: () => {
          Object.assign(filters, { q: "", status: "All", category: "", priority: "", min: "", max: "", from: "", to: "" });
          buildToolbar(); renderDisputesBody();
        } }, "Clear filters") : null
      ]));
      return;
    }
    const head = ["Customer", "Dispute ID", "Order ID", "Category", "Amount", "Received", "Response deadline", "Status", "Priority", ""];
    body.replaceChildren(el("div", { class: "box table-box" }, el("div", { class: "table-scroll" }, el("table", { class: "data-table" }, [
      el("thead", null, el("tr", null, head.map((h) => el("th", { scope: "col", text: h })))),
      el("tbody", null, rows.map(({ item, wf, p }) => {
        const stage = stageOf(statusOf(item));
        const tr = el("tr", { class: "click-row" }, [
          el("td", { "data-label": "Customer" }, [el("span", { class: "cell-strong", text: item.buyer_name || "Not listed" }), item.sample ? el("span", { class: "badge", text: "Sample" }) : null]),
          el("td", { "data-label": "Dispute ID", class: "mono", text: item.dispute_id }),
          el("td", { "data-label": "Order ID", class: "mono" + (item.order_id ? "" : " muted"), text: item.order_id || "Not linked" }),
          el("td", { "data-label": "Category", text: REASONS[item.reason] || "Other" }),
          el("td", { "data-label": "Amount", class: "mono num", text: money(item.dispute_amount) }),
          el("td", { "data-label": "Received", text: date(item.create_time) }),
          el("td", { "data-label": "Deadline" }, stage === "needs" && item.seller_response_due_date
            ? [el("span", { class: "cell-date", text: dateTime(item.seller_response_due_date) }), countdownEl(item.seller_response_due_date)]
            : el("span", { class: "muted", text: stage === "resolved" ? "Closed" : "Responded" })),
          el("td", { "data-label": "Status" }, el("span", { class: "badge " + STATUS_TONE[wf], text: wf })),
          el("td", { "data-label": "Priority" }, p ? el("span", { class: "badge " + LEVEL_TONE[p.level], text: p.level }) : el("span", { class: "muted", text: "None" })),
          el("td", { class: "cell-action" }, el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: (e) => { e.stopPropagation(); openCase(item.dispute_id); } }, "Open"))
        ]);
        tr.addEventListener("click", () => openCase(item.dispute_id));
        return tr;
      }))
    ]))));
  }

  // ---------- AI investigations ----------

  function renderInvestigations() {
    const rows = state.items.filter((i) => state.briefs[i.dispute_id])
      .sort((a, b) => String(state.briefs[b.dispute_id]._at || "").localeCompare(String(state.briefs[a.dispute_id]._at || "")));
    const host = $("investigations-body");
    if (!rows.length) {
      host.replaceChildren(el("div", { class: "box empty-box" }, [
        el("p", { class: "empty-title", text: "No investigations yet" }),
        el("p", { class: "muted", text: "Open a case and click Start investigation. The agent reads the dispute, the PayPal order and your records, then recommends what to do." }),
        el("a", { class: "btn btn-primary", href: "#overview" }, "See cases that need attention")
      ]));
      return;
    }
    host.replaceChildren(el("div", { class: "box table-box" }, el("div", { class: "table-scroll" }, el("table", { class: "data-table" }, [
      el("thead", null, el("tr", null, ["Customer", "Dispute ID", "Recommendation", "Confidence", "Status", "Investigated", ""].map((h) => el("th", { scope: "col", text: h })))),
      el("tbody", null, rows.map((item) => {
        const b = state.briefs[item.dispute_id];
        const wf = workflowOf(item);
        const tr = el("tr", { class: "click-row" }, [
          el("td", { "data-label": "Customer" }, [el("span", { class: "cell-strong", text: item.buyer_name || "Not listed" }), item.sample ? el("span", { class: "badge", text: "Sample" }) : null]),
          el("td", { "data-label": "Dispute ID", class: "mono", text: item.dispute_id }),
          el("td", { "data-label": "Recommendation" }, el("span", { class: "badge " + ({ FIGHT: "good", REFUND: "warn", OFFER: "info" }[b.verdict] || ""), text: VERDICTS[b.verdict] })),
          el("td", { "data-label": "Confidence", text: b.confidence.charAt(0) + b.confidence.slice(1).toLowerCase() }),
          el("td", { "data-label": "Status" }, el("span", { class: "badge " + STATUS_TONE[wf], text: wf })),
          el("td", { "data-label": "Investigated", text: b._at ? dateTime(b._at) : "Earlier" }),
          el("td", { class: "cell-action" }, el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: (e) => { e.stopPropagation(); openCase(item.dispute_id); } }, "Open"))
        ]);
        tr.addEventListener("click", () => openCase(item.dispute_id));
        return tr;
      }))
    ]))));
  }

  // ---------- deadline radar ----------

  const cal = { view: "month", cursor: new Date(), selected: null };

  function deadlineItems() {
    const { items } = workPool();
    return items.filter((i) => stageOf(statusOf(i)) === "needs" && i.seller_response_due_date)
      .sort((a, b) => new Date(a.seller_response_due_date) - new Date(b.seller_response_due_date));
  }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function nextAction(item) {
    const { items } = workPool();
    const needsMax = Math.max(0, ...items.filter((i) => stageOf(statusOf(i)) === "needs").map(amountOf));
    const p = priorityOf(item, needsMax);
    return p ? p.action : "None";
  }

  function chip(item, withTime) {
    const u = urgencyOf(item.seller_response_due_date);
    const due = new Date(item.seller_response_due_date);
    return el("button", {
      type: "button",
      class: "cal-chip " + u + (cal.selected === item.dispute_id ? " selected" : ""),
      "aria-pressed": cal.selected === item.dispute_id ? "true" : "false",
      "aria-label": (item.buyer_name || item.dispute_id) + ", " + money(item.dispute_amount) + ", due " + dateTime(item.seller_response_due_date),
      onclick: () => { cal.selected = item.dispute_id; renderRadarPage(); }
    }, [
      withTime ? el("span", { class: "cal-time mono", text: due.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) }) : null,
      el("span", { class: "cal-name", text: item.buyer_name || item.dispute_id }),
      el("span", { class: "cal-amt mono", text: money(item.dispute_amount) })
    ]);
  }

  function renderCalendar(items) {
    const host = $("calendar");
    const today = new Date();
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    if (cal.view === "month") {
      const first = new Date(cal.cursor.getFullYear(), cal.cursor.getMonth(), 1);
      const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
      $("h-calendar").textContent = first.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      const cells = [];
      for (let k = 0; k < 42; k++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + k);
        const due = items.filter((i) => sameDay(new Date(i.seller_response_due_date), d));
        cells.push(el("div", { class: "cal-cell" + (d.getMonth() !== first.getMonth() ? " other" : "") + (sameDay(d, today) ? " today" : "") }, [
          el("span", { class: "cal-day", text: String(d.getDate()) }),
          ...due.slice(0, 3).map((i) => chip(i, false)),
          due.length > 3 ? el("button", { type: "button", class: "cal-more", onclick: () => { cal.view = "week"; cal.cursor = d; renderRadarPage(); } }, "+" + (due.length - 3) + " more") : null
        ]));
      }
      host.replaceChildren(el("div", { class: "cal-grid month" }, [
        ...weekdays.map((w) => el("span", { class: "cal-wd", text: w })),
        ...cells
      ]));
    } else {
      const start = new Date(cal.cursor.getFullYear(), cal.cursor.getMonth(), cal.cursor.getDate() - cal.cursor.getDay());
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
      const f = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      $("h-calendar").textContent = f(start) + " to " + f(end) + ", " + end.getFullYear();
      const cols = [];
      for (let k = 0; k < 7; k++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + k);
        const due = items.filter((i) => sameDay(new Date(i.seller_response_due_date), d));
        cols.push(el("div", { class: "cal-col" + (sameDay(d, today) ? " today" : "") }, [
          el("div", { class: "cal-col-head" }, [el("span", { text: weekdays[k] }), el("b", { text: String(d.getDate()) })]),
          due.length ? el("div", { class: "cal-col-list" }, due.map((i) => chip(i, true))) : el("span", { class: "cal-none", text: "No deadlines" })
        ]));
      }
      host.replaceChildren(el("div", { class: "cal-grid week" }, cols));
    }
    document.querySelectorAll("#cal-seg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.cal === cal.view ? "true" : "false"));
  }

  function renderRadarDetail(items) {
    const host = $("radar-detail");
    const item = items.find((i) => i.dispute_id === cal.selected);
    if (!item) {
      const counts = { critical: 0, warning: 0, upcoming: 0 };
      items.forEach((i) => { const u = urgencyOf(i.seller_response_due_date); if (counts[u] != null) counts[u]++; });
      host.replaceChildren(
        el("h2", { class: "rd-title", text: "Deadline details" }),
        el("p", { class: "muted", text: items.length ? "Select a deadline in the calendar to see its details." : "No response deadlines right now." }),
        el("div", { class: "mini-counts" }, [
          el("span", { class: "badge bad", text: counts.critical + " critical" }),
          el("span", { class: "badge warn", text: counts.warning + " warning" }),
          el("span", { class: "badge", text: counts.upcoming + " upcoming" })
        ])
      );
      return;
    }
    host.replaceChildren(
      el("h2", { class: "rd-title", text: item.buyer_name || "Customer not listed" }),
      el("p", { class: "rd-sub" }, [el("span", { class: "mono", text: item.dispute_id }), " · " + (REASONS[item.reason] || "Dispute")]),
      el("dl", { class: "rd-list" }, [
        ["Deadline", dateTime(item.seller_response_due_date)],
        ["Time left", countdownEl(item.seller_response_due_date)],
        ["Amount at risk", el("span", { class: "mono", text: money(item.dispute_amount) })],
        ["Status", el("span", { class: "badge " + STATUS_TONE[workflowOf(item)], text: workflowOf(item) })],
        ["Action required", nextAction(item)]
      ].map(([k, v]) => el("div", null, [el("dt", { text: k }), el("dd", null, v)]))),
      el("button", { type: "button", class: "btn btn-primary", onclick: () => openCase(item.dispute_id) }, "Open case")
    );
  }

  function renderUpcoming(items) {
    const host = $("upcoming");
    if (!items.length) {
      host.replaceChildren(el("p", { class: "empty-state", text: "No response deadlines right now. When PayPal sets one, it shows here with a countdown." }));
      return;
    }
    host.replaceChildren(el("div", { class: "table-scroll" }, el("table", { class: "data-table" }, [
      el("thead", null, el("tr", null, ["Customer", "Dispute ID", "Deadline", "Countdown", "Amount at risk", "Action required", ""].map((h) => el("th", { scope: "col", text: h })))),
      el("tbody", null, items.map((item) => {
        const tr = el("tr", { class: "click-row" }, [
          el("td", { "data-label": "Customer" }, [el("span", { class: "cell-strong", text: item.buyer_name || "Not listed" }), item.sample ? el("span", { class: "badge", text: "Sample" }) : null]),
          el("td", { "data-label": "Dispute ID", class: "mono", text: item.dispute_id }),
          el("td", { "data-label": "Deadline", text: dateTime(item.seller_response_due_date) }),
          el("td", { "data-label": "Countdown" }, countdownEl(item.seller_response_due_date)),
          el("td", { "data-label": "Amount", class: "mono num", text: money(item.dispute_amount) }),
          el("td", { "data-label": "Action", text: nextAction(item) }),
          el("td", { class: "cell-action" }, el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: (e) => { e.stopPropagation(); openCase(item.dispute_id); } }, "Open"))
        ]);
        tr.addEventListener("click", () => openCase(item.dispute_id));
        return tr;
      }))
    ])));
  }

  function reminderChecks(hostId) {
    const p = Store.prefs();
    $(hostId).replaceChildren(...[["h48", "48 hours before"], ["h24", "24 hours before"], ["h6", "6 hours before"]].map(([k, label]) => {
      const box = el("input", { type: "checkbox", id: hostId + "-" + k, checked: p.reminders[k] });
      box.addEventListener("change", () => {
        const q = Store.prefs();
        q.reminders[k] = box.checked;
        Store.savePrefs(q);
        Notify.sync();
      });
      return el("label", { class: "check", for: hostId + "-" + k }, [box, label]);
    }));
  }

  function renderRadarPage() {
    const items = deadlineItems();
    renderCalendar(items);
    renderRadarDetail(items);
    renderUpcoming(items);
    reminderChecks("reminder-prefs");
  }

  // ---------- case history ----------

  function renderHistory() {
    const { items, sampleOnly } = workPool();
    const rows = items.filter((i) => stageOf(statusOf(i)) === "resolved")
      .sort((a, b) => new Date(b.resolved_time || b.update_time) - new Date(a.resolved_time || a.update_time));
    const host = $("history-body");
    if (!rows.length) {
      host.replaceChildren(el("div", { class: "box empty-box" }, [
        el("p", { class: "empty-title", text: "No resolved disputes yet" }),
        el("p", { class: "muted", text: "When PayPal closes a dispute, it moves here with its outcome." })
      ]));
      return;
    }
    const n = (o) => rows.filter((i) => outcomeOf(i.dispute_id) === o).length;
    host.replaceChildren(
      el("div", { class: "mini-counts history-counts" }, [
        el("span", { class: "badge good", text: n("won") + " won" }),
        el("span", { class: "badge bad", text: n("lost") + " lost" }),
        el("span", { class: "badge warn", text: n("refunded") + " refunded" }),
        sampleOnly ? el("span", { class: "sample-tag", text: "Sample data" }) : null
      ]),
      el("div", { class: "box table-box" }, el("div", { class: "table-scroll" }, el("table", { class: "data-table" }, [
        el("thead", null, el("tr", null, ["Customer", "Dispute ID", "Category", "Amount", "Received", "Resolved", "Days to resolve", "Outcome", ""].map((h) => el("th", { scope: "col", text: h })))),
        el("tbody", null, rows.map((item) => {
          const resolvedAt = item.resolved_time || item.update_time;
          const days = Math.round((new Date(resolvedAt) - new Date(item.create_time)) / 86400000);
          const tr = el("tr", { class: "click-row" }, [
            el("td", { "data-label": "Customer" }, [el("span", { class: "cell-strong", text: item.buyer_name || "Not listed" }), item.sample ? el("span", { class: "badge", text: "Sample" }) : null]),
            el("td", { "data-label": "Dispute ID", class: "mono", text: item.dispute_id }),
            el("td", { "data-label": "Category", text: REASONS[item.reason] || "Other" }),
            el("td", { "data-label": "Amount", class: "mono num", text: money(item.dispute_amount) }),
            el("td", { "data-label": "Received", text: date(item.create_time) }),
            el("td", { "data-label": "Resolved", text: date(resolvedAt) }),
            el("td", { "data-label": "Days", class: "mono num", text: isFinite(days) ? String(days) : "Not listed" }),
            el("td", { "data-label": "Outcome" }, stageBadge(item)),
            el("td", { class: "cell-action" }, el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: (e) => { e.stopPropagation(); openCase(item.dispute_id); } }, "Open"))
          ]);
          tr.addEventListener("click", () => openCase(item.dispute_id));
          return tr;
        }))
      ])))
    );
  }

  // ---------- integrations, preferences, planned pages ----------

  function integrationCard(name, status, tone, body, extra) {
    return el("section", { class: "box integ" }, [
      el("div", { class: "box-head" }, [el("h2", { text: name }), el("span", { class: "badge " + tone, text: status })]),
      el("p", { class: "muted", text: body }),
      extra || null
    ]);
  }

  function renderIntegrations() {
    const m = state.mode || {};
    $("integrations-body").replaceChildren(el("div", { class: "integ-grid" }, [
      integrationCard("PayPal", m.paypal ? "Connected (" + m.env + ")" : "Not connected", m.paypal ? "good" : "",
        m.paypal
          ? "Casefile reads your disputes, payments and orders, and sends evidence, offers and messages through PayPal's APIs. Nothing is sent without your approval."
          : "Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in Vercel to load your real disputes. Until then, Casefile shows sample cases.",
        m.paypal && m.env === "sandbox" ? el("a", { class: "btn btn-secondary btn-sm", href: "/shop.html" }, "Open the demo store") : null),
      integrationCard("Claude AI agent", m.ai ? "Ready" : "Not connected", m.ai ? "good" : "",
        m.ai ? "Investigates each dispute with read-only tools locked to that case, then drafts a recommendation for you to approve."
          : "Add ANTHROPIC_API_KEY in Vercel to turn on investigations."),
      integrationCard("Shopify and WooCommerce", "Planned", "", "Pull orders, customer history and fulfilment straight from your store, so you don't have to paste records. Planned for Phase 5."),
      integrationCard("Carrier tracking", "Planned", "", "Check USPS, UPS, FedEx and DHL delivery events automatically, including delivery photos and signatures. Planned for Phase 5."),
      integrationCard("Email and Slack alerts", "Planned", "", "Send deadline reminders outside Casefile, so you hear about them even when it isn't open. Planned for Phase 5.")
    ]));
  }

  function renderPreferences() {
    const p = Store.prefs();
    const name = el("input", { type: "text", id: "pref-name", maxlength: "60", value: p.storeName, placeholder: "Your store" });
    name.addEventListener("input", () => { const q = Store.prefs(); q.storeName = name.value; Store.savePrefs(q); renderStatus(); });
    const types = Object.entries(Notify.TYPES).map(([k, t]) => {
      const box = el("input", { type: "checkbox", id: "pref-n-" + k, checked: p.notify[k] !== false });
      box.addEventListener("change", () => { const q = Store.prefs(); q.notify[k] = box.checked; Store.savePrefs(q); Notify.render(); });
      return el("label", { class: "check", for: "pref-n-" + k }, [box, t.label]);
    });
    $("preferences-body").replaceChildren(
      el("section", { class: "box" }, [
        el("div", { class: "box-head" }, el("h2", null, el("label", { for: "pref-name", text: "Store name" }))),
        el("p", { class: "box-hint", text: "Shown in the sidebar." }),
        el("div", { class: "pref-field" }, name)
      ]),
      el("section", { class: "box" }, [
        el("div", { class: "box-head" }, el("h2", { text: "Notifications" })),
        el("p", { class: "box-hint", text: "Choose what appears in the notification panel." }),
        el("div", { class: "checks" }, types)
      ]),
      el("section", { class: "box" }, [
        el("div", { class: "box-head" }, el("h2", { text: "Deadline reminders" })),
        el("p", { class: "box-hint", text: "Get a notification when a response deadline gets this close." }),
        el("div", { class: "checks", id: "pref-reminders" })
      ]),
      el("section", { class: "box" }, [
        el("div", { class: "box-head" }, el("h2", { text: "Data saved in this browser" })),
        el("p", { class: "box-hint", text: "Your investigations, case activity, notifications and these settings are kept in this browser only. Clearing them doesn't change anything on PayPal." }),
        el("button", { type: "button", class: "btn btn-secondary", onclick: async () => {
          if (!(await confirmStep("Clear data saved in this browser?", "Investigations, case activity, notifications and preferences will be removed from this browser. Your PayPal disputes are not affected.", "Clear data"))) return;
          Store.clearAll();
          location.reload();
        } }, "Clear saved data")
      ])
    );
    reminderChecks("pref-reminders");
  }

  // Everything planned but not built yet, in one place instead of empty pages in the menu.
  const PLANNED = {
    vault: ["Evidence Vault", "Phase 3", "One place for every receipt, tracking proof, photo and message, linked to the cases they support and reusable across disputes."],
    calculator: ["Refund vs. fight calculator", "Phase 3", "Weighs the disputed amount, PayPal's dispute fee, your chance of winning and the time involved, so you can see which choice costs less."],
    analytics: ["Analytics", "Phase 4", "Trends in why buyers dispute, which products and carriers cause the most cases, and how your win rate changes over time."],
    risk: ["Risk Monitor", "Phase 4", "Early warnings about orders likely to become disputes, such as delivered parcels with no signature or repeat claimants."],
    memory: ["Case memory", "Phase 4", "Learns from your past outcomes, so the agent knows which evidence wins for your store."],
    team: ["Team members", "Phase 5", "Invite staff, assign cases, and require a second approval before anything is sent to PayPal."],
    integrations: ["Store and carrier integrations", "Phase 5", "Pull orders from Shopify and WooCommerce and check USPS, UPS, FedEx and DHL tracking directly, instead of pasting records."],
    alerts: ["Email and Slack alerts", "Phase 5", "Deadline reminders that reach you even when Casefile isn't open."]
  };
  function renderRoadmap() {
    const phases = {};
    Object.values(PLANNED).forEach(([title, phase, body]) => { (phases[phase] = phases[phase] || []).push([title, body]); });
    $("page-upcoming").replaceChildren(
      el("header", { class: "page-head" }, el("div", null, [
        el("h1", { id: "h-upcoming-page", text: "Roadmap" }),
        el("p", { class: "page-sub", text: "What's built today, and what comes next." })
      ])),
      el("section", { class: "box" }, [
        el("div", { class: "box-head" }, [el("h2", { text: "Built today" }), el("span", { class: "badge good", text: "Phases 1 and 2" })]),
        el("ul", { class: "roadmap-list" }, [
          "Dashboard, priority queue and deadline radar",
          "All disputes with search, filters and sorting",
          "AI investigation across six stages, with honest status for each",
          "Evidence strength ratings, missing evidence and the contradiction finder",
          "Approval before anything is sent, then evidence, offers and messages through PayPal"
        ].map((t) => el("li", { text: t })))
      ]),
      ...Object.entries(phases).map(([phase, items]) => el("section", { class: "box" }, [
        el("div", { class: "box-head" }, [el("h2", { text: phase }), el("span", { class: "badge info", text: "Planned" })]),
        el("dl", { class: "roadmap-dl" }, items.map(([title, body]) => el("div", null, [el("dt", { text: title }), el("dd", { text: body })])))
      ]))
    );
  }

  // ---------- page switching ----------

  function renderRoute(route) {
    if (route === "overview") { renderStats(); renderQueue(); renderFinance(); renderRadarMini(); }
    else if (route === "disputes") { buildToolbar(); renderDisputesBody(); }
    else if (route === "investigations") renderInvestigations();
    else if (route === "radar") renderRadarPage();
    else if (route === "history") renderHistory();
    else if (route === "integrations") renderIntegrations();
    else if (route === "preferences") renderPreferences();
    else if (route === "roadmap") renderRoadmap();
  }

  function currentRoute() {
    const h = decodeURIComponent(location.hash.replace(/^#/, ""));
    return h || "overview";
  }

  function handleRoute() {
    const r = currentRoute();
    closeMenu();
    if (r.startsWith("case-")) {
      const id = r.slice(5);
      if (state.currentId === id && !$("case-view").hidden) return;
      markNav(state.lastView);
      openCase(id);
      return;
    }
    // Old links to the planned pages now land on the roadmap.
    const route = ["vault", "analytics", "risk", "team"].includes(r) ? "roadmap" : ROUTE_TITLES[r] ? r : "overview";
    state.currentId = null;
    state.run++;
    state.lastView = route;
    showPage(route === "roadmap" ? "page-upcoming" : "page-" + route);
    markNav(route);
    document.title = ROUTE_TITLES[route] + " · Casefile";
    renderRoute(route);
    window.scrollTo(0, 0);
  }

  function renderAll() {
    renderCounts();
    const r = currentRoute();
    if (r.startsWith("case-")) {
      const list = document.querySelector("#case-view .case-list");
      if (list && state.caseData) list.replaceWith(caseList());
    } else {
      renderRoute(ROUTE_TITLES[r] ? r : "overview");
    }
    const { sampleOnly } = workPool();
    const today = new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" });
    const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    $("overview-sub").textContent = today + (sampleOnly ? " · showing sample cases" : "") + " · updated " + time;
  }

  // Keep every countdown on screen current.
  function tick() {
    document.querySelectorAll(".countdown[data-due]").forEach((n) => {
      n.textContent = countdownText(n.dataset.due);
      n.className = "countdown badge " + URGENCY_TONE[urgencyOf(n.dataset.due)];
    });
  }

  // ---------- sidebar collapse and mobile menu ----------

  function applyCollapsed() {
    const collapsed = Store.prefs().sidebarCollapsed;
    $("shell").classList.toggle("collapsed", collapsed);
    const btn = $("collapse-btn");
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    btn.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
    btn.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
  }
  function openMenu() {
    $("shell").classList.add("menu-open");
    $("scrim").hidden = false;
    $("menu-btn").setAttribute("aria-expanded", "true");
  }
  function closeMenu() {
    $("shell").classList.remove("menu-open");
    $("scrim").hidden = true;
    $("menu-btn").setAttribute("aria-expanded", "false");
  }

  function init() {
    applyCollapsed();
    renderStatus();
    $("collapse-btn").addEventListener("click", () => {
      const p = Store.prefs();
      p.sidebarCollapsed = !p.sidebarCollapsed;
      Store.savePrefs(p);
      applyCollapsed();
      if (currentRoute() === "overview") renderFinance();
    });
    $("menu-btn").addEventListener("click", () => ($("shell").classList.contains("menu-open") ? closeMenu() : openMenu()));
    $("scrim").addEventListener("click", closeMenu);
    document.querySelectorAll("[data-refresh]").forEach((b) => b.addEventListener("click", loadInbox));
    document.querySelectorAll("#dataset-seg button").forEach((b) => b.addEventListener("click", () => {
      const p = Store.prefs();
      p.dataset = b.dataset.dataset;
      Store.savePrefs(p);
      renderStatus();
      renderAll();
      Notify.sync();
    }));
    document.querySelectorAll("#range-seg button").forEach((b) => b.addEventListener("click", () => {
      range = b.dataset.range;
      document.querySelectorAll("#range-seg button").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
      renderFinance();
    }));
    document.querySelectorAll("#cal-seg button").forEach((b) => b.addEventListener("click", () => { cal.view = b.dataset.cal; renderRadarPage(); }));
    $("cal-prev").addEventListener("click", () => { shiftCal(-1); });
    $("cal-next").addEventListener("click", () => { shiftCal(1); });
    $("cal-today").addEventListener("click", () => { cal.cursor = new Date(); renderRadarPage(); });
    window.addEventListener("hashchange", handleRoute);
    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (currentRoute() === "overview") renderFinance(); }, 150);
    });
    setInterval(tick, 30000);
    handleRoute();
  }
  function shiftCal(dir) {
    const c = cal.cursor;
    cal.cursor = cal.view === "month" ? new Date(c.getFullYear(), c.getMonth() + dir, 1) : new Date(c.getFullYear(), c.getMonth(), c.getDate() + dir * 7);
    renderRadarPage();
  }

  return { init, renderAll, renderStatus, handleRoute };
})();
