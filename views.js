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

  // ---------- overview: shared helpers ----------

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

  let range = "30d";
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

  // The selected period, and the equally long period just before it for "vs. last period".
  function periodBounds(r) {
    const bs = buckets(r);
    const start = bs[0].start.getTime();
    const end = bs[bs.length - 1].end.getTime();
    return { bs, start, end, prevStart: start - (end - start), prevEnd: start };
  }
  const inRange = (iso, a, b) => { const t = new Date(iso).getTime(); return isFinite(t) && t >= a && t < b; };
  const resolvedAt = (i) => i.resolved_time || i.update_time;
  const isResolved = (i) => stageOf(statusOf(i)) === "resolved";

  function seriesData(items, bs) {
    const rows = bs.map((b) => ({ b, disputed: 0, refunded: 0, recovered: 0, count: 0 }));
    const find = (t) => { const ms = new Date(t).getTime(); return rows.find((r) => ms >= r.b.start.getTime() && ms < r.b.end.getTime()); };
    for (const i of items) {
      const amt = amountOf(i);
      const opened = i.create_time && find(i.create_time);
      if (opened) { opened.disputed += amt; opened.count += 1; }
      if (isResolved(i)) {
        const row = resolvedAt(i) && find(resolvedAt(i));
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
  function placeTip(evt) {
    const tip = $("tooltip");
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

  // The money change against last period, shown as an amount (a percentage of a small number looks inflated).
  // upIsGood decides the colour; with nothing last period there is nothing to compare.
  function delta(cur, prev, upIsGood, currency) {
    if (!prev) return cur ? { text: "New this period", tone: "info" } : null;
    const diff = Math.round((cur - prev) * 100) / 100;
    if (diff === 0) return { text: "No change", tone: "" };
    const good = upIsGood ? diff > 0 : diff < 0;
    return { text: (diff > 0 ? "+" : "−") + fmt(currency, Math.abs(diff)), tone: good ? "good" : "bad" };
  }

  // ---------- overview: KPI cards ----------

  function kpi(label, value, chip, foot, extraClass) {
    return el("div", { class: "kpi" + (extraClass ? " " + extraClass : "") }, [
      el("span", { class: "kpi-label", text: label }),
      el("span", { class: "kpi-value figure", text: value }),
      el("div", { class: "kpi-foot" }, [
        chip ? el("span", { class: "chip-delta " + chip.tone, text: chip.text }) : null,
        el("span", { class: "kpi-sub" }, foot)
      ])
    ]);
  }

  function renderKpis() {
    const { items, sampleOnly } = workPool();
    const P = periodBounds(range);
    const active = items.filter((i) => !isResolved(i));
    const needs = items.filter((i) => stageOf(statusOf(i)) === "needs");
    const urgent = needs.filter((i) => { const h = hoursLeft(i.seller_response_due_date); return h != null && h < 72; });
    const risk = sumByCurrency(active);
    const resolvedIn = (a, b) => items.filter((i) => isResolved(i) && inRange(resolvedAt(i), a, b));
    const wonOf = (list) => list.filter((i) => outcomeOf(i.dispute_id) === "won");
    const rNow = resolvedIn(P.start, P.end);
    const rPrev = resolvedIn(P.prevStart, P.prevEnd);
    const protNow = sumByCurrency(wonOf(rNow));
    const protPrev = sumByCurrency(wonOf(rPrev));
    const rate = rNow.length ? (wonOf(rNow).length / rNow.length) * 100 : null;
    const ratePrev = rPrev.length ? (wonOf(rPrev).length / rPrev.length) * 100 : null;
    let rateChip = null;
    if (rate != null && ratePrev != null) {
      const d = Math.round(rate - ratePrev);
      rateChip = d === 0 ? { text: "No change", tone: "" } : { text: (d > 0 ? "+" : "−") + Math.abs(d) + " pts", tone: d > 0 ? "good" : "bad" };
    }
    const tag = sampleOnly ? el("span", { class: "sample-tag", text: "Sample data" }) : null;
    $("kpis").replaceChildren(
      kpi("Money at risk", fmt(risk.cur, risk.value), null,
        [active.length + " active case" + (active.length === 1 ? "" : "s") + (risk.mixed ? ", plus other currencies" : ""), tag]),
      kpi("Needs attention", String(needs.length),
        urgent.length ? { text: urgent.length + " urgent", tone: "bad" } : null,
        [needs.length ? "Responses you still owe" : "Nothing waiting on you"], urgent.length ? "kpi-alert" : ""),
      kpi("Money protected", fmt(protNow.cur, protNow.value), delta(protNow.value, protPrev.value, true, protNow.cur),
        ["vs. " + fmt(protPrev.cur, protPrev.value) + " last period"]),
      kpi("Win rate", rate == null ? "No data" : Math.round(rate) + "%", rateChip,
        [rNow.length ? wonOf(rNow).length + " won of " + rNow.length + " resolved" : "None resolved this period"])
    );
  }

  // ---------- overview: money disputed (line chart + outcomes) ----------

  function renderMoney() {
    const { items } = workPool();
    const host = $("finance");
    const P = periodBounds(range);
    const rows = seriesData(items, P.bs);
    const cur = sumByCurrency(items).cur;
    const openedIn = (a, b) => items.filter((i) => inRange(i.create_time, a, b));
    const now = sumByCurrency(openedIn(P.start, P.end)).value;
    const prev = sumByCurrency(openedIn(P.prevStart, P.prevEnd)).value;
    const chip = delta(now, prev, false, cur);
    $("money-note").textContent = "Opened in this period";

    // Line chart: one axis, three series, a crosshair and tooltip on hover.
    // Drawn after the layout is in place so it matches the width it is given.
    const chartBox = el("div", { class: "chart-wrap" });
    const drawChart = () => {
    const width = Math.max(260, Math.floor(chartBox.clientWidth || 600));
    const H = 220;
    const M = { l: 44, r: 10, t: 12, b: 24 };
    const plotW = width - M.l - M.r;
    const plotH = H - M.t - M.b;
    const maxV = niceMax(Math.max(0, ...rows.map((r) => Math.max(r.disputed, r.refunded, r.recovered))));
    const step = rows.length > 1 ? plotW / (rows.length - 1) : plotW;
    const x = (i) => M.l + (rows.length > 1 ? i * step : plotW / 2);
    const y = (v) => M.t + plotH - (v / maxV) * plotH;
    const svg = svgEl("svg", { viewBox: "0 0 " + width + " " + H, width, height: H, class: "chart", role: "img", "aria-label": "Money disputed, refunded or lost, and recovered per period" });
    for (let k = 0; k <= 4; k++) {
      const v = (maxV / 4) * k;
      svg.append(svgEl("line", { x1: M.l, x2: width - M.r, y1: y(v), y2: y(v), class: k === 0 ? "axis" : "grid" }));
      svg.append(svgEl("text", { x: M.l - 6, y: y(v) + 4, class: "tick", "text-anchor": "end" }, short$(v, cur)));
    }
    const labelEvery = Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor(plotW / 60))));
    rows.forEach((r, i) => {
      const last = rows.length - 1;
      // Always label the first and last period; skip a label that would crowd the last one.
      if ((i % labelEvery === 0 && (i === last || last - i >= labelEvery)) || i === last) svg.append(svgEl("text", { x: x(i), y: H - 6, class: "tick", "text-anchor": i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle" }, r.b.label));
    });
    const pts = (key) => rows.map((r, i) => x(i) + "," + y(r[key]));
    svg.append(svgEl("path", { d: "M" + pts("disputed").join(" L") + " L" + x(rows.length - 1) + "," + y(0) + " L" + x(0) + "," + y(0) + " Z", class: "area s1" }));
    SERIES.forEach((s) => svg.append(svgEl("path", { d: "M" + pts(s.key).join(" L"), class: "line " + s.cls })));
    const cross = svgEl("line", { x1: 0, x2: 0, y1: M.t, y2: M.t + plotH, class: "crosshair", visibility: "hidden" });
    svg.append(cross);
    const dots = SERIES.map((s) => { const c = svgEl("circle", { r: 4.5, class: "dot " + s.cls, visibility: "hidden" }); svg.append(c); return c; });
    rows.forEach((r, i) => {
      const left = i === 0 ? M.l : x(i) - step / 2;
      const right = i === rows.length - 1 ? width - M.r : x(i) + step / 2;
      const hit = svgEl("rect", { x: left, y: 0, width: Math.max(1, right - left), height: H - M.b, class: "hit", tabindex: 0,
        "aria-label": r.b.long + ": disputed " + fmt(cur, r.disputed) + ", refunded or lost " + fmt(cur, r.refunded) + ", recovered " + fmt(cur, r.recovered) });
      const show = (e) => {
        cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
        SERIES.forEach((s, k) => { dots[k].setAttribute("cx", x(i)); dots[k].setAttribute("cy", y(r[s.key])); dots[k].setAttribute("visibility", "visible"); });
        $("tooltip").replaceChildren(
          el("strong", { text: r.b.long }),
          ...SERIES.map((s) => el("span", { class: "tip-row" }, [el("span", { class: "swatch " + s.cls }), s.label + ": ", el("b", { text: fmt(cur, r[s.key]) })])),
          el("span", { class: "tip-row" }, ["New disputes: ", el("b", { text: String(r.count) })])
        );
        placeTip(e);
      };
      const hide = () => { cross.setAttribute("visibility", "hidden"); dots.forEach((d) => d.setAttribute("visibility", "hidden")); hideTip(); };
      hit.addEventListener("mousemove", show);
      hit.addEventListener("focus", show);
      hit.addEventListener("mouseleave", hide);
      hit.addEventListener("blur", hide);
      svg.append(hit);
    });
    chartBox.replaceChildren(svg);
    };

    const table = el("table", { class: "data-table compact", hidden: !showTable }, [
      el("thead", null, el("tr", null, ["Period", ...SERIES.map((s) => s.label), "New disputes"].map((t) => el("th", { scope: "col", text: t })))),
      el("tbody", null, rows.map((r) => el("tr", null, [
        el("th", { scope: "row", text: r.b.long }),
        ...SERIES.map((s) => el("td", { class: "mono", text: fmt(cur, r[s.key]) })),
        el("td", { class: "mono", text: String(r.count) })
      ])))
    ]);

    // Outcomes in the period, each with a bar sized to its share.
    const rNow = items.filter((i) => isResolved(i) && inRange(resolvedAt(i), P.start, P.end));
    const count = (o) => rNow.filter((i) => outcomeOf(i.dispute_id) === o).length;
    const outs = [["Won", "won", "good"], ["Lost", "lost", "bad"], ["Refunded", "refunded", "warn"]];
    const total = Math.max(1, rNow.length);
    const outBox = el("div", { class: "outcomes" }, [
      el("div", { class: "outcomes-head" }, [el("b", { text: "Outcomes" }), el("span", { class: "muted small", text: rNow.length + " resolved this period" })]),
      el("div", { class: "outcomes-grid" }, outs.map(([label, key, tone]) => {
        const n = count(key);
        const bar = el("span", { class: "out-bar " + tone });
        bar.dataset.pct = String(Math.round((n / total) * 100));
        return el("div", { class: "out" }, [
          el("span", { class: "out-label" }, [el("span", { class: "out-dot " + tone }), label]),
          el("span", { class: "out-num figure", text: String(n) }),
          el("span", { class: "out-track" }, bar)
        ]);
      }))
    ]);

    host.replaceChildren(
      el("div", { class: "money-top" }, [
        el("div", { class: "money-figure" }, [
          el("span", { class: "money-big figure", text: fmt(cur, now) }),
          el("div", { class: "kpi-foot" }, [chip ? el("span", { class: "chip-delta " + chip.tone, text: chip.text }) : null, el("span", { class: "kpi-sub", text: "vs. " + fmt(cur, prev) + " last period" })]),
          el("div", { class: "chart-legend" }, SERIES.map((s) => el("span", { class: "leg" }, [el("span", { class: "swatch " + s.cls }), s.label])))
        ]),
        el("div", { class: "money-chart" }, [
          showTable ? null : chartBox,
          el("div", { class: "table-scroll" }, table),
          el("button", { type: "button", class: "btn btn-ghost btn-sm chart-toggle", onclick: () => { showTable = !showTable; renderMoney(); } }, showTable ? "Show as chart" : "Show as table")
        ])
      ]),
      outBox
    );
    if (!showTable) drawChart();
    host.querySelectorAll(".out-bar").forEach((b) => { b.style.width = b.dataset.pct + "%"; });
  }

  // ---------- overview: deadlines this week ----------

  function renderWeek() {
    const { items } = workPool();
    const needs = items.filter((i) => stageOf(statusOf(i)) === "needs" && i.seller_response_due_date);
    const today = new Date();
    const days = [];
    for (let k = 0; k < 7; k++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + k);
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      const due = needs.filter((i) => { const t = new Date(i.seller_response_due_date); return t >= d && t < next; });
      days.push({ d, label: k === 0 ? "Today" : d.toLocaleDateString("en-US", { weekday: "short" }), due, sum: sumByCurrency(due) });
    }
    const overdue = needs.filter((i) => new Date(i.seller_response_due_date) < new Date(today.getFullYear(), today.getMonth(), today.getDate()));
    const max = Math.max(1, ...days.map((x) => x.due.length));
    const peak = days.reduce((a, b) => (b.due.length > a.due.length ? b : a), days[0]);
    const W = 320, H = 190, M = { t: 22, b: 24 };
    const colW = W / 7;
    const barW = Math.min(30, colW * 0.62);
    const plotH = H - M.t - M.b;
    const svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, class: "chart week-chart", role: "img", "aria-label": "Response deadlines in each of the next 7 days" });
    days.forEach((day, k) => {
      const n = day.due.length;
      const h = n ? Math.max(8, (n / max) * plotH) : 6;
      const bx = k * colW + (colW - barW) / 2;
      const hi = n > 0 && day === peak;
      const bar = svgEl("path", { d: barPath(bx, M.t + plotH - h, barW, h), class: n ? (hi ? "wbar hi" : "wbar") : "wbar empty" });
      const title = day.d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) + ": " + n + (n === 1 ? " response" : " responses") + " due" + (n ? ", " + fmt(day.sum.cur, day.sum.value) + " at stake" : "");
      const g = svgEl("g", { class: "wcol", tabindex: 0, role: "link", "aria-label": title + ". Open Deadline Radar." }, [svgEl("title", null, title), bar]);
      if (hi || (n && n === max)) g.append(svgEl("text", { x: bx + barW / 2, y: M.t + plotH - h - 6, class: "wval", "text-anchor": "middle" }, String(n)));
      g.append(svgEl("text", { x: bx + barW / 2, y: H - 6, class: "tick" + (k === 0 ? " today" : ""), "text-anchor": "middle" }, day.label));
      const go = () => { location.hash = "radar"; };
      g.addEventListener("click", go);
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
      svg.append(g);
    });
    const weekDue = days.reduce((t, x) => t.concat(x.due), []);
    const weekSum = sumByCurrency(weekDue);
    $("week").replaceChildren(
      svg,
      el("p", { class: "week-sum" }, [
        el("b", { text: weekDue.length + (weekDue.length === 1 ? " response" : " responses") + " due in the next 7 days" }),
        weekDue.length ? ", " + fmt(weekSum.cur, weekSum.value) + " at stake." : ".",
        overdue.length ? el("span", { class: "overdue-note", text: " " + overdue.length + " already overdue." }) : null
      ]),
      // The next responses due, soonest first, so the seller can jump straight in.
      needs.length ? el("div", { class: "week-next" }, [
        el("p", { class: "wl-head", text: "Due next" }),
        el("ul", { class: "week-list" }, needs.slice()
          .sort((a, b) => new Date(a.seller_response_due_date) - new Date(b.seller_response_due_date))
          .slice(0, 3)
          .map((i) => el("li", null, el("button", { type: "button", class: "wl-row", onclick: () => openCase(i.dispute_id) }, [
            el("span", { class: "wl-who" }, [
              el("span", { class: "wl-name", text: i.buyer_name || i.dispute_id }),
              el("span", { class: "wl-sub", text: money(i.dispute_amount) + " · " + (REASONS[i.reason] || "Dispute") })
            ]),
            countdownEl(i.seller_response_due_date)
          ]))))
      ]) : null
    );
  }

  // ---------- overview: cases that need attention (table) ----------

  function renderQueue() {
    const { items } = workPool();
    const ranked = rankedOpen(items);
    const now = ranked.filter((r) => r.p.level !== "Low");
    const monitored = ranked.filter((r) => r.p.level === "Low");
    const host = $("queue");
    if (!now.length) {
      host.replaceChildren(el("p", { class: "empty-state", text: "Nothing needs your attention right now. New disputes from PayPal are ranked here as they arrive." }));
      return;
    }
    const table = el("table", { class: "data-table q-table" }, [
      el("thead", null, el("tr", null, ["Dispute ID", "Customer", "Amount", "Time left", "Priority", "Next step"].map((h) => el("th", { scope: "col", text: h })))),
      el("tbody", null, now.map(({ item, p }) => {
        const due = item.seller_response_due_date;
        const tr = el("tr", { class: "click-row", title: "Why: " + p.reasons.map((r) => r.text).join(", ") }, [
          el("td", { "data-label": "Dispute ID", class: "mono", text: item.dispute_id }),
          el("td", { "data-label": "Customer" }, el("span", { class: "cell-stack" }, [
            el("span", { class: "cell-strong", text: item.buyer_name || "Not listed" }),
            el("span", { class: "cell-sub", text: REASONS[item.reason] || "Dispute" })
          ])),
          el("td", { "data-label": "Amount", class: "num figure", text: money(item.dispute_amount) }),
          el("td", { "data-label": "Time left" }, due ? countdownEl(due) : el("span", { class: "muted", text: "Not listed" })),
          el("td", { "data-label": "Priority" }, el("span", { class: "badge q-pri " + LEVEL_TONE[p.level], text: p.level })),
          el("td", { "data-label": "Next step", class: "q-next", text: p.action })
        ]);
        tr.addEventListener("click", () => openCase(item.dispute_id));
        return tr;
      }))
    ]);
    host.replaceChildren(
      el("div", { class: "table-scroll" }, table),
      monitored.length ? el("p", { class: "q-foot muted small" }, [
        monitored.length + (monitored.length === 1 ? " case is" : " cases are") + " waiting on PayPal or the buyer. ",
        el("a", { href: "#disputes", class: "box-link", onclick: () => { filters.status = "Submitted"; } }, "See them")
      ]) : null
    );
  }

  // ---------- overview: win rate gauge ----------

  function renderGauge() {
    const { items } = workPool();
    const resolved = items.filter(isResolved);
    const won = resolved.filter((i) => outcomeOf(i.dispute_id) === "won");
    const rate = resolved.length ? won.length / resolved.length : null;
    const times = resolved.map((i) => (new Date(resolvedAt(i)) - new Date(i.create_time)) / 86400000).filter((d) => isFinite(d) && d >= 0);
    const avg = times.length ? times.reduce((s, d) => s + d, 0) / times.length : null;
    const W = 240, H = 136, cx = 120, cy = 124, R1 = 92, R2 = 112, N = 36;
    const svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, class: "gauge", role: "img", "aria-label": rate == null ? "No resolved disputes yet" : "Win rate " + Math.round(rate * 100) + " percent" });
    for (let k = 0; k < N; k++) {
      const a = Math.PI - (k / (N - 1)) * Math.PI;
      const on = rate != null && k / (N - 1) <= rate;
      svg.append(svgEl("line", { x1: cx + R1 * Math.cos(a), y1: cy - R1 * Math.sin(a), x2: cx + R2 * Math.cos(a), y2: cy - R2 * Math.sin(a), class: on ? "gtick on" : "gtick" }));
    }
    svg.append(svgEl("text", { x: cx, y: cy - 22, class: "gval", "text-anchor": "middle" }, rate == null ? "No data" : Math.round(rate * 100) + "%"));
    $("gauge").replaceChildren(
      svg,
      el("p", { class: "gauge-sub", text: resolved.length ? won.length + " won of " + resolved.length + " resolved" : "No resolved disputes yet" }),
      el("p", { class: "gauge-sub muted small", text: avg == null ? "" : "Average resolution: " + (avg < 10 ? avg.toFixed(1) : Math.round(avg)) + " days" }),
      el("a", { class: "btn btn-secondary btn-sm gauge-btn", href: "#history" }, "Show details")
    );
  }

  // ---------- overview: AI investigations ----------

  function renderAi() {
    const { items } = workPool();
    const investigated = items.filter((i) => state.briefs[i.dispute_id]);
    const awaiting = items.filter((i) => workflowOf(i) === "Awaiting approval");
    const next = rankedOpen(items).find((r) => stageOf(statusOf(r.item)) === "needs" && !state.briefs[r.item.dispute_id]);
    const host = $("ai-card");
    host.replaceChildren(
      el("div", { class: "ai-stats" }, [
        el("div", null, [el("span", { class: "ai-num figure", text: String(investigated.length) }), el("span", { class: "ai-label", text: "Investigated" })]),
        el("div", null, [el("span", { class: "ai-num figure", text: String(awaiting.length) }), el("span", { class: "ai-label", text: "Awaiting your approval" })])
      ]),
      next ? el("div", { class: "ai-next" }, [
        el("span", { class: "ai-next-label", text: "Next to investigate" }),
        el("span", { class: "ai-next-name" }, [next.item.buyer_name || next.item.dispute_id, el("span", { class: "badge " + LEVEL_TONE[next.p.level], text: next.p.level })]),
        el("span", { class: "muted small", text: (REASONS[next.item.reason] || "Dispute") + " · " + money(next.item.dispute_amount) }),
        el("button", { type: "button", class: "btn btn-primary btn-sm", onclick: () => { Workspace.presetTab(next.item.dispute_id, "investigation"); openCase(next.item.dispute_id); } }, "Open investigation")
      ]) : el("p", { class: "muted small", text: "Every open case has been investigated." })
    );
  }

  function renderPeriodText() {
    const P = periodBounds(range);
    const f = (t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    $("period-text").textContent = f(P.start) + " to " + f(P.end - 86400000);
  }

  function renderOverview() {
    renderPeriodText();
    renderKpis();
    renderMoney();
    renderWeek();
    renderQueue();
    renderGauge();
    renderAi();
  }

  // ---------- export ----------

  // Downloads the cases currently shown (your disputes or sample cases) as a CSV file.
  function exportCsv() {
    const { items, sampleOnly } = workPool();
    const head = ["Dispute ID", "Customer", "Category", "Amount", "Currency", "Status", "Opened", "Response deadline", "Resolved", "Order ID", "Payment ID"];
    const rows = items.map((i) => [
      i.dispute_id, i.buyer_name || "", REASONS[i.reason] || i.reason || "",
      i.dispute_amount ? i.dispute_amount.value : "", i.dispute_amount ? i.dispute_amount.currency_code : "",
      workflowOf(i), i.create_time || "", i.seller_response_due_date || "",
      isResolved(i) ? resolvedAt(i) || "" : "", i.order_id || "", i.transaction_id || ""
    ]);
    // Quote every field, and neutralise values a spreadsheet would treat as a formula.
    const cell = (v) => {
      let s = String(v == null ? "" : v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const csv = [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: "casefile-" + (sampleOnly ? "sample-" : "") + "disputes-" + new Date().toISOString().slice(0, 10) + ".csv" });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
          el("td", { "data-label": "Amount", class: "num figure", text: money(item.dispute_amount) }),
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
          el("td", { "data-label": "Amount", class: "num figure", text: money(item.dispute_amount) }),
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
            el("td", { "data-label": "Amount", class: "num figure", text: money(item.dispute_amount) }),
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
    accounts: ["Seller accounts and Connect with PayPal", "Phase 5", "Each seller signs up for their own account and connects PayPal in one step, with their data kept in a secure database instead of the browser, so it follows them across devices."],
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
    if (route === "overview") renderOverview();
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
  function currentTheme() {
    const t = Store.prefs().theme;
    if (t === "light" || t === "dark") return t;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function applyTheme() {
    const t = Store.prefs().theme;
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
    const dark = currentTheme() === "dark";
    const btn = $("theme-btn");
    btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    btn.title = dark ? "Switch to light mode" : "Switch to dark mode";
    btn.replaceChildren(icon(dark ? "sun" : "moon"));
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
      if (currentRoute() === "overview") renderMoney();
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
    $("period-select").value = range;
    $("period-select").addEventListener("change", (e) => { range = e.target.value; renderOverview(); });
    $("export-csv").addEventListener("click", exportCsv);

    // Top bar search: shows the matches on All Disputes. Ctrl K (or Command K on a Mac) jumps to it.
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    $("search-kbd").textContent = isMac ? "⌘ K" : "Ctrl K";
    const narrow = window.matchMedia("(max-width: 640px)");
    const setPlaceholder = () => { $("global-search").placeholder = narrow.matches ? "Search disputes" : "Search customer, dispute or order ID"; };
    setPlaceholder();
    if (narrow.addEventListener) narrow.addEventListener("change", setPlaceholder);
    $("topsearch").addEventListener("submit", (e) => {
      e.preventDefault();
      filters.q = $("global-search").value.trim();
      if (currentRoute() === "disputes") { buildToolbar(); renderDisputesBody(); }
      else location.hash = "disputes";
    });
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key && e.key.toLowerCase() === "k") {
        e.preventDefault();
        $("global-search").focus();
        $("global-search").select();
      }
    });

    // Light or dark: follows the device until the seller picks one.
    applyTheme();
    $("theme-btn").addEventListener("click", () => {
      const p = Store.prefs();
      p.theme = currentTheme() === "dark" ? "light" : "dark";
      Store.savePrefs(p);
      applyTheme();
    });
    document.querySelectorAll("#cal-seg button").forEach((b) => b.addEventListener("click", () => { cal.view = b.dataset.cal; renderRadarPage(); }));
    $("cal-prev").addEventListener("click", () => { shiftCal(-1); });
    $("cal-next").addEventListener("click", () => { shiftCal(1); });
    $("cal-today").addEventListener("click", () => { cal.cursor = new Date(); renderRadarPage(); });
    window.addEventListener("hashchange", handleRoute);
    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (currentRoute() === "overview") renderMoney(); }, 150);
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
