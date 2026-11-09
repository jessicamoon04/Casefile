"use strict";

// Phase 2: the investigation workspace, evidence intelligence, contradiction finder and summary report.
// Builds on the case page in app.js. Statuses of the six stages come from the server's code, not the AI.

const Workspace = (() => {
  const STAGE_DEFS = [
    { key: "dispute", tool: "get_dispute", n: 1, title: "PayPal dispute information", upload: null },
    { key: "order", tool: "get_order_details", n: 2, title: "Transaction and order details", upload: null },
    { key: "shipping", tool: "get_shipping_records", n: 3, title: "Shipping and carrier tracking", upload: "TRACKING" },
    { key: "conversations", tool: "get_customer_conversations", n: 4, title: "Customer conversations", upload: "CONVERSATION" },
    { key: "policies", tool: "get_store_policies", n: 5, title: "Store refund and shipping policies", upload: "POLICY" },
    { key: "documents", tool: "get_uploaded_documents", n: 6, title: "Uploaded documents and evidence", upload: "OTHER" }
  ];
  const STAGE_ENUM = { DISPUTE: "dispute", ORDER: "order", SHIPPING: "shipping", CONVERSATIONS: "conversations", POLICIES: "policies", DOCUMENTS: "documents" };
  const STATUS = {
    PENDING: ["Pending", ""], INVESTIGATING: ["Investigating", "info"], COMPLETED: ["Completed", "good"],
    NEEDS_INPUT: ["Requires seller input", "warn"], UNABLE: ["Unable to retrieve", "bad"]
  };
  const BASIS = {
    VERIFIED_SOURCE: ["Verified source", "good"], SELLER_PROVIDED: ["Seller-provided", "info"],
    AI_INTERPRETATION: ["AI interpretation", ""], UNVERIFIED: ["Unverified", "warn"], MISSING: ["Missing", "bad"]
  };
  const RATING = { STRONG: ["Strong", "good"], MODERATE: ["Moderate", "info"], WEAK: ["Weak", "warn"], INSUFFICIENT: ["Insufficient", "bad"] };
  const FINDING = {
    CONTRADICTED: ["Contradicted", "good"], CONFIRMED: ["Confirmed", "warn"],
    PARTIALLY_SUPPORTED: ["Partially supported", "info"], UNABLE_TO_VERIFY: ["Unable to verify", ""]
  };
  const CATEGORY = {
    TRACKING: "Tracking", PROOF_OF_DELIVERY: "Proof of delivery", CONVERSATION: "Conversation", POLICY: "Store policy",
    RECEIPT: "Receipt or invoice", PHOTO: "Photo", PACKING: "Packing record", CUSTOMER_HISTORY: "Customer history", OTHER: "Other"
  };
  const SOURCE = {
    PAYPAL_DISPUTE: "PayPal dispute", PAYPAL_ORDER: "PayPal order", SELLER_RECORDS: "Your pasted records",
    UPLOADED_DOCUMENT: "Document", NONE: "No source"
  };
  const LEVEL = { HIGH: "High", MEDIUM: "Medium", LOW: "Low" };

  // Briefs saved before Phase 2 used a smaller shape; bring them up to date so nothing breaks.
  function normalizeBrief(b) {
    if (!b) return b;
    if (!Array.isArray(b.claims)) {
      b.claims = (b.claim_check || []).map((c) => ({
        claim: c.claim, claim_basis: "BUYER_MESSAGE",
        finding: c.finding === "SUPPORTED" ? "CONFIRMED" : c.finding === "UNVERIFIED" ? "UNABLE_TO_VERIFY" : c.finding,
        evidence: c.evidence, explanation: "", source: c.source || "NONE", document_id: "", excerpt: ""
      }));
    }
    if (!Array.isArray(b.missing)) {
      b.missing = (b.gaps || []).map((g) => ({ item: String(g), why_it_matters: "", how_it_helps: "", where_to_get: "", category: "OTHER" }));
    }
    b.evidence_assessment = Array.isArray(b.evidence_assessment) ? b.evidence_assessment : [];
    b.stage_findings = Array.isArray(b.stage_findings) ? b.stage_findings : [];
    b.weaknesses = Array.isArray(b.weaknesses) ? b.weaknesses : [];
    b._flags = Array.isArray(b._flags) ? b._flags : [];
    return b;
  }

  // ---------- documents (sample documents from the server plus uploads in this browser) ----------

  const uploaded = {}; // dispute_id -> uploaded docs (loaded from IndexedDB)
  async function loadDocs(id) {
    uploaded[id] = await Docs.list(id);
    if (state.currentId === id) refresh();
  }
  function allDocs(id) {
    const sample = (state.caseData && state.caseData.dispute.dispute_id === id ? state.caseData.documents || [] : []);
    return sample.concat(uploaded[id] || []);
  }
  function docById(id, docId) {
    return allDocs(id).find((d) => d.id === docId) || null;
  }
  function newEvidenceSince(id, brief) {
    if (!brief || !brief._at) return [];
    return (uploaded[id] || []).filter((d) => d.addedAt > brief._at);
  }

  let pendingCategory = "OTHER";
  function pickFile(category) {
    pendingCategory = category || "OTHER";
    const input = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp,application/pdf,text/plain,.txt,.eml,.csv,.md", hidden: true });
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      const id = state.currentId;
      try {
        const doc = await Docs.add(id, file, pendingCategory);
        Store.log(id, "document_added", doc.name);
        flash(id, { ok: true, text: "Added " + doc.name + ". Rerun the analysis to include it." });
      } catch (e) {
        flash(id, { ok: false, text: e.message });
      }
      await loadDocs(id);
    });
    document.body.append(input);
    input.click();
  }
  const flashes = {};
  function flash(id, msg) { flashes[id] = msg; }
  function flashBox(id) {
    const m = flashes[id];
    return m ? el("div", { class: "result " + (m.ok ? "ok" : "bad"), text: m.text }) : null;
  }

  // ---------- viewer: documents, PayPal records, previous runs ----------

  function openViewer(title, nodes, sub) {
    const dlg = $("viewer");
    $("viewer-title").textContent = title;
    $("viewer-sub").textContent = sub || "";
    $("viewer-body").replaceChildren(...[].concat(nodes).filter(Boolean));
    if (!dlg.open) dlg.showModal();
  }
  function previewDoc(doc) {
    const sub = (CATEGORY[doc.category] || "Other") + " · " + (doc.demo ? "Sample document (invented for the demo)" : "Uploaded by you") +
      (doc.date || doc.addedAt ? " · " + date(doc.date || doc.fileDate || doc.addedAt) : "");
    if (doc.kind === "image") openViewer(doc.name, el("img", { class: "doc-img", src: doc.dataUrl, alt: doc.name }), sub);
    else if (doc.kind === "pdf") {
      openViewer(doc.name, [
        el("p", { class: "muted", text: "PDF documents open in a new tab." }),
        el("button", { type: "button", class: "btn btn-secondary", onclick: () => {
          const bytes = atob(String(doc.dataUrl).split(",")[1] || "");
          const arr = new Uint8Array(bytes.length);
          for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
          window.open(URL.createObjectURL(new Blob([arr], { type: "application/pdf" })), "_blank", "noopener");
        } }, "Open PDF")
      ], sub);
    } else openViewer(doc.name, el("pre", { class: "records doc-text", text: doc.text || "" }), sub);
  }
  function sourceText(cd, source) {
    if (source === "PAYPAL_DISPUTE") {
      const d = cd.dispute;
      return ["Reason: " + (REASONS[d.reason] || d.reason), "Amount: " + money(d.dispute_amount), "Opened: " + dateTime(d.create_time),
        "Response due: " + dateTime(d.seller_response_due_date), "Stage: " + (LIFECYCLE[d.dispute_life_cycle_stage] || "Not listed"), "",
        "Messages:", ...(d.messages || []).map((m) => (m.posted_by || "") + " · " + dateTime(m.time_posted) + "\n" + m.content)].join("\n");
    }
    if (source === "PAYPAL_ORDER") {
      const o = cd.order;
      if (!o) return "No checkout order is linked to this payment.";
      const u = (o.purchase_units || [])[0] || {};
      const s = u.shipping || {};
      const a = s.address || {};
      return ["Order " + o.id, "Amount: " + money(u.amount), "", "Items:", ...(u.items || []).map((i) => (i.quantity || 1) + " x " + i.name + " at " + money(i.unit_amount)), "",
        "Ship to: " + ((s.name && s.name.full_name) || ""), [a.address_line_1, a.address_line_2, a.admin_area_2, a.admin_area_1, a.postal_code, a.country_code].filter(Boolean).join(", "),
        "", "Tracking on the order: " + ((s.trackers || []).map((t) => String(t.id).split("-").slice(-1)[0]).join(", ") || "none")].join("\n");
    }
    if (source === "SELLER_RECORDS") return (cd.sample ? cd.records : state.records[cd.dispute.dispute_id]) || "";
    return "";
  }
  function viewSource(source, docId) {
    const cd = state.caseData;
    const doc = docId ? docById(cd.dispute.dispute_id, docId) : null;
    if (doc) { previewDoc(doc); return; }
    if (source === "PAYPAL_DISPUTE" || source === "PAYPAL_ORDER") {
      openViewer(SOURCE[source] + " record", el("pre", { class: "records doc-text", text: sourceText(cd, source) }), "Verified source: retrieved from PayPal" + (cd.sample ? " (sample data)" : ""));
      return;
    }
    if (source === "SELLER_RECORDS") {
      openViewer("Your pasted records", el("pre", { class: "records doc-text", text: sourceText(cd, source) || "No records pasted." }), "Seller-provided");
      return;
    }
    openViewer("Source not available", el("p", { class: "muted", text: "The AI didn't point to a specific document for this finding." }));
  }

  // Check a quoted excerpt against the real source text, so a misquote is visible.
  function norm(s) {
    return String(s || "").toLowerCase().replace(/[“”‘’"']/g, "").replace(/\s+/g, " ").trim();
  }
  function excerptCheck(cd, finding) {
    if (!finding.excerpt) return null;
    const doc = finding.document_id ? docById(cd.dispute.dispute_id, finding.document_id) : null;
    let text = "";
    if (doc) {
      if (doc.kind !== "text") return { state: "cant", text: "Quote from an image or PDF: Casefile can't check it automatically" };
      text = doc.text;
    } else if (finding.source === "PAYPAL_DISPUTE" || finding.source === "PAYPAL_ORDER" || finding.source === "SELLER_RECORDS") {
      text = sourceText(cd, finding.source) + (finding.source === "PAYPAL_DISPUTE" ? "" : "");
    } else {
      text = allDocs(cd.dispute.dispute_id).filter((d) => d.kind === "text").map((d) => d.text).join("\n") + "\n" + sourceText(cd, "PAYPAL_DISPUTE") + "\n" + sourceText(cd, "SELLER_RECORDS");
    }
    const found = norm(text).includes(norm(finding.excerpt).replace(/\.\.\.$/, ""));
    return found ? { state: "ok", text: "Quote found word for word in the source" } : { state: "bad", text: "Quote not found in the source text. Treat this finding with caution." };
  }

  // ---------- flags ----------

  function flagControl(brief, key, findingText) {
    const id = state.currentId;
    const existing = brief._flags.find((f) => f.key === key);
    if (existing) {
      return el("div", { class: "flagged" }, [
        el("span", { class: "badge bad", text: "Flagged by you" }),
        el("span", { class: "flag-reason", text: existing.reason || "No reason given" }),
        el("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => {
          brief._flags = brief._flags.filter((f) => f.key !== key);
          Store.saveBriefs(state.briefs);
          refresh();
        } }, "Remove flag")
      ]);
    }
    const wrap = el("div", { class: "flag-wrap" });
    const open = () => {
      const ta = el("textarea", { rows: "2", maxlength: "400", placeholder: "What's wrong with this finding?", "aria-label": "Why this finding is incorrect" });
      wrap.replaceChildren(ta, el("div", { class: "decide" }, [
        el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => {
          brief._flags.push({ key, finding: findingText, reason: ta.value.trim(), at: new Date().toISOString() });
          Store.saveBriefs(state.briefs);
          Store.log(id, "finding_flagged", findingText.slice(0, 80));
          refresh();
        } }, "Save flag"),
        el("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => wrap.replaceChildren(btn) }, "Cancel")
      ]));
      ta.focus();
    };
    const btn = el("button", { type: "button", class: "btn btn-ghost btn-sm flag-btn", onclick: open }, "Flag as incorrect");
    wrap.append(btn);
    return wrap;
  }

  // ---------- running an investigation (pause and resume between turns) ----------

  const live = {}; // dispute_id -> { status, trace, messages, sig, started, reason, reassess, pauseRequested, error }

  async function start(opts) {
    const id = state.currentId;
    const o = opts || {};
    live[id] = { status: "running", trace: [], messages: null, sig: null, started: Date.now(), reason: o.reason || "Initial investigation", reassess: o.reassess || null };
    Store.log(id, "investigation_started", o.reason && o.reason !== "Initial investigation" ? o.reason : "");
    setTab("investigation");
    await run(id);
  }

  async function run(id) {
    const r = live[id];
    r.status = "running";
    r.pauseRequested = false;
    r.error = null;
    state.running[id] = true;
    refresh();
    const ticker = setInterval(() => { const n = $("ws-timer"); if (n && state.currentId === id) n.textContent = elapsed(r.started); }, 1000);
    try {
      const payload = await Docs.payload(id);
      for (let turn = 0; turn < 10; turn++) {
        const body = {
          dispute_id: id,
          records: state.caseData.sample ? "" : (state.records[id] || ""),
          documents: payload.documents,
          messages: r.messages,
          sig: r.sig
        };
        if (!r.messages) {
          body.attachments = payload.attachments;
          if (r.reassess) body.reassess = r.reassess;
        }
        const step = await api("/api/agent", { method: "POST", body });
        r.trace.push(...step.trace);
        if (step.done) {
          finish(id, step.brief);
          return;
        }
        r.messages = step.messages;
        r.sig = step.sig;
        if (r.pauseRequested) {
          r.status = "paused";
          Store.log(id, "investigation_paused");
          return;
        }
        if (state.currentId === id) refresh();
      }
      throw new Error("The investigation took too many steps. Start it again.");
    } catch (e) {
      r.status = "error";
      r.error = e.message;
    } finally {
      clearInterval(ticker);
      if (r.status !== "running") delete state.running[id];
      if (r.status === "done") delete state.running[id];
      if (state.currentId === id) refresh();
    }
  }

  function finish(id, brief) {
    const r = live[id];
    const prev = state.briefs[id] ? normalizeBrief(state.briefs[id]) : null;
    brief._trace = r.trace;
    brief._at = new Date().toISOString();
    brief._reason = r.reason;
    brief._flags = [];
    brief._took = Math.round((Date.now() - r.started) / 1000);
    state.briefs[id] = normalizeBrief(brief);
    Store.saveBriefs(state.briefs);
    Store.addRun(id, { at: brief._at, reason: r.reason, verdict: brief.verdict, confidence: brief.confidence, brief });
    Store.log(id, "investigation_completed", VERDICTS[brief.verdict] + ", " + brief.confidence.toLowerCase() + " confidence" + (prev ? " (was " + VERDICTS[prev.verdict].toLowerCase() + ")" : ""));
    r.status = "done";
    delete state.running[id];
    delete state.results[id];
    Notify.sync();
  }

  function pause(id) {
    if (live[id] && live[id].status === "running") {
      live[id].pauseRequested = true;
      refresh();
    }
  }
  function resume(id) {
    if (live[id] && (live[id].status === "paused" || live[id].status === "error") && live[id].messages) {
      Store.log(id, "investigation_resumed");
      run(id);
    }
  }
  function elapsed(t0) {
    const s = Math.floor((Date.now() - t0) / 1000);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  async function askReassess(reasonDefault) {
    const id = state.currentId;
    const brief = state.briefs[id] ? normalizeBrief(state.briefs[id]) : null;
    const flags = brief ? brief._flags : [];
    const notes = Store.notes(id);
    const reason = el("select", { id: "reassess-reason" }, [
      "New evidence added", "Findings flagged as incorrect", "Seller notes added", "Fresh look at the case"
    ].map((t) => el("option", { value: t, selected: t === reasonDefault }, t)));
    const incNotes = el("input", { type: "checkbox", id: "reassess-notes", checked: notes.length > 0, disabled: notes.length === 0 });
    const extra = el("div", { class: "reassess-form" }, [
      el("label", { class: "field-label", for: "reassess-reason", text: "Reason" }), reason,
      el("p", { class: "muted", text: flags.length ? flags.length + " flagged finding" + (flags.length === 1 ? "" : "s") + " will be sent so the AI reconsiders them." : "No findings are flagged." }),
      el("label", { class: "check", for: "reassess-notes" }, [incNotes, notes.length ? "Include my " + notes.length + " internal note" + (notes.length === 1 ? "" : "s") : "No internal notes to include"])
    ]);
    if (!(await confirmStep("Request a reassessment?", "The agent re-examines every stage with your current documents. Your previous run is kept in the history.", "Start reassessment", extra))) return;
    start({
      reason: reason.value,
      reassess: {
        reason: reason.value,
        flags: flags.map((f) => ({ finding: f.finding, reason: f.reason })),
        notes: incNotes.checked ? notes.map((n) => n.text) : []
      }
    });
  }

  // ---------- tab: investigation ----------

  function stageStateFor(trace, running) {
    const metas = {};
    for (const t of trace || []) if (t.kind === "tool" && t.stage) metas[t.stage.key] = t.stage;
    const disputeDone = Boolean(metas.dispute);
    return STAGE_DEFS.map((s) => {
      const meta = metas[s.key];
      let status = meta ? meta.status : "PENDING";
      if (!meta && running && (s.key === "dispute" || disputeDone)) status = "INVESTIGATING";
      return { def: s, meta, status };
    });
  }

  function basisChip(basis) {
    const [label, tone] = BASIS[basis] || BASIS.UNVERIFIED;
    return el("span", { class: "badge basis " + tone, text: label });
  }

  function stageCard(s, brief, running) {
    const [label, tone] = STATUS[s.status];
    const findings = brief ? brief.stage_findings.filter((f) => STAGE_ENUM[f.stage] === s.def.key) : [];
    // Completed stages start collapsed with a one-line summary; ones that need the seller stay open.
    const open = s.meta && s.status !== "COMPLETED";
    const sub = s.meta
      ? (findings[0] ? findings[0].text : s.meta.examined) + (s.meta.missing.length ? " · " + s.meta.missing.length + " missing" : "")
      : s.status === "INVESTIGATING" ? "Examining now..." : "Waiting";
    const body = [];
    if (s.meta) {
      body.push(el("div", { class: "st-block" }, [el("h4", { text: "What was examined" }), el("p", { text: s.meta.examined })]));
      body.push(el("div", { class: "st-block" }, [el("h4", { text: "Information retrieved" }),
        s.meta.retrieved.length ? el("ul", null, s.meta.retrieved.map((x) => el("li", { text: x }))) : el("p", { class: "muted", text: "Nothing could be retrieved." })]));
      body.push(el("div", { class: "st-block" }, [el("h4", { text: "Evidence collected" }),
        s.meta.evidence.length ? el("ul", { class: "st-evidence" }, s.meta.evidence.map((e) => el("li", null, [basisChip(e.basis), " ", e.document_id
          ? el("button", { type: "button", class: "link-btn", onclick: () => { const d = docById(state.currentId, e.document_id); if (d) previewDoc(d); } }, e.label) : e.label])))
          : el("p", { class: "muted", text: "None." })]));
      body.push(el("div", { class: "st-block" }, [el("h4", { text: "Findings" }),
        findings.length ? el("ul", { class: "st-findings" }, findings.map((f) => el("li", null, [basisChip(f.basis), " ", f.text])))
          : el("p", { class: "muted", text: brief ? "No findings for this stage." : running ? "Findings appear when the analysis is complete." : "Run the analysis to see findings." })]));
      if (s.meta.missing.length) {
        body.push(el("div", { class: "st-block st-missing" }, [el("h4", { text: "Missing information" }),
          el("ul", null, s.meta.missing.map((m) => el("li", null, [basisChip("MISSING"), " ", m])))]));
      }
      if (s.status === "NEEDS_INPUT" && s.def.upload) {
        body.push(el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => pickFile(s.def.upload) }, "Add a document for this stage"));
      }
    }
    return el("li", { class: "stage " + s.status.toLowerCase() }, [
      el("span", { class: "st-num mono", "aria-hidden": "true" }, s.status === "COMPLETED" ? icon("check") : s.status === "INVESTIGATING" ? el("span", { class: "st-spin" }) : String(s.def.n)),
      el("details", { class: "st-card", open: open || null }, [
        el("summary", null, [
          el("span", { class: "st-title" }, [el("b", { text: s.def.title }), el("span", { class: "st-sub", text: sub })]),
          el("span", { class: "badge " + tone, text: label })
        ]),
        body.length ? el("div", { class: "st-body" }, body) : null
      ])
    ]);
  }

  function renderInvestigation(host) {
    const id = state.currentId;
    const cd = state.caseData;
    const brief = state.briefs[id] ? normalizeBrief(state.briefs[id]) : null;
    const r = live[id];
    const running = r && r.status === "running";
    const trace = r && r.status !== "done" ? r.trace : brief ? brief._trace || [] : [];
    const stages = stageStateFor(trace, running);
    const findingsFiled = (trace || []).some((t) => t.name === "submit_findings");
    const briefFiled = (trace || []).some((t) => t.name === "submit_case_brief");
    const allStagesIn = stages.every((s) => s.meta);
    const analysisStatus = briefFiled ? "COMPLETED" : running && allStagesIn ? "INVESTIGATING" : "PENDING";
    const doneCount = stages.filter((s) => s.meta).length + (findingsFiled ? 0.5 : 0) + (briefFiled ? 0.5 : 0);
    const pct = Math.round((doneCount / 7) * 100);
    const stage = stageOf(currentStatus());

    let controls;
    if (running) {
      controls = [
        el("span", { class: "run-status" }, [el("span", { class: "live-dot" }), r.pauseRequested ? "Pausing after this step · " : "Investigating · ", el("span", { id: "ws-timer", class: "mono", text: elapsed(r.started) })]),
        el("button", { type: "button", class: "btn btn-secondary", disabled: r.pauseRequested || null, onclick: () => pause(id) }, r.pauseRequested ? "Pausing..." : "Pause")
      ];
    } else if (r && (r.status === "paused" || (r.status === "error" && r.messages))) {
      controls = [
        el("span", { class: "badge " + (r.status === "paused" ? "warn" : "bad"), text: r.status === "paused" ? "Paused" : "Stopped by an error" }),
        el("button", { type: "button", class: "btn btn-primary", onclick: () => resume(id) }, "Resume"),
        el("button", { type: "button", class: "btn btn-ghost", onclick: () => start({ reason: r.reason, reassess: r.reassess }) }, "Start over")
      ];
    } else if (brief) {
      controls = [
        el("span", { class: "badge good", text: "Investigation complete" }),
        el("button", { type: "button", class: "btn btn-secondary", onclick: () => askReassess(newEvidenceSince(id, brief).length ? "New evidence added" : brief._flags.length ? "Findings flagged as incorrect" : "Fresh look at the case") }, "Request reassessment")
      ];
    } else {
      controls = [el("button", { type: "button", class: "btn btn-primary", disabled: stage === "resolved" || null, onclick: () => start({}) }, "Start investigation")];
    }

    const fresh = brief ? newEvidenceSince(id, brief) : [];
    const thoughts = (trace || []).filter((t) => t.kind === "thought" || t.kind === "note");

    host.replaceChildren(...[
      el("section", { class: "box ws-head" }, [
        el("div", { class: "box-head" }, [
          el("div", null, [el("h2", { text: "Investigation room" }), el("p", { class: "box-hint ws-hint", text: "The agent works through six stages in order. What each stage retrieved is decided by Casefile from the data it actually has, not by the AI." })]),
          el("div", { class: "box-head-right" }, controls)
        ]),
        el("div", { class: "progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct), "aria-label": "Investigation progress" }, el("span", { class: "progress-bar", "data-pct": String(pct) })),
        el("div", { class: "legend-chips basis-legend" }, Object.keys(BASIS).map((k) => basisChip(k))),
        r && r.status === "error" ? el("div", { class: "result bad", text: r.error }) : null,
        fresh.length && !running ? el("div", { class: "notice notice-warn" }, [
          fresh.length + " document" + (fresh.length === 1 ? " was" : "s were") + " added after this investigation. ",
          el("button", { type: "button", class: "link-btn", onclick: () => askReassess("New evidence added") }, "Rerun the analysis with the new evidence")
        ]) : null,
        flashBox(id)
      ]),
      el("div", { class: "ws-grid" }, [
        el("div", null, [
          el("ol", { class: "timeline-ws" }, [
            ...stages.map((s) => stageCard(s, brief && !running ? brief : null, running)),
            el("li", { class: "stage " + analysisStatus.toLowerCase() }, [
              el("span", { class: "st-num mono", "aria-hidden": "true" }, analysisStatus === "COMPLETED" ? icon("check") : analysisStatus === "INVESTIGATING" ? el("span", { class: "st-spin" }) : "7"),
              el("div", { class: "st-card st-static" }, [
                el("div", { class: "st-summary" }, [
                  el("span", { class: "st-title" }, [el("b", { text: "Analysis and report" }), el("span", { class: "st-sub", text: briefFiled ? (brief ? VERDICTS[brief.verdict] + ", " + brief.confidence.toLowerCase() + " confidence" : "Done") : findingsFiled ? "Findings filed, writing the recommendation..." : "Evidence strength, contradictions, missing evidence and recommendation" })]),
                  el("span", { class: "badge " + STATUS[analysisStatus][1], text: STATUS[analysisStatus][0] })
                ]),
                briefFiled && brief ? el("div", { class: "decide st-actions" }, [
                  el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => setTab("summary") }, "Read the summary"),
                  el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => setTab("contradictions") }, "Compare claims"),
                  el("button", { type: "button", class: "btn btn-primary btn-sm", onclick: () => setTab("response") }, "Review the response")
                ]) : null
              ])
            ])
          ]),
          thoughts.length ? el("details", { class: "box agent-notes" }, [
            el("summary", null, ["Agent's working notes ", basisChip("AI_INTERPRETATION")]),
            el("ul", { class: "feed" }, thoughts.map(feedItem))
          ]) : null
        ]),
        el("aside", { class: "ws-side" }, [notesPanel(id), historyPanel(id)])
      ])
    ].filter(Boolean));
    host.querySelectorAll(".progress-bar").forEach((b) => { b.style.width = b.dataset.pct + "%"; });
  }

  function notesPanel(id) {
    const notes = Store.notes(id);
    const ta = el("textarea", { id: "note-input", rows: "3", maxlength: "600", placeholder: "Only you see these. You can include them in a reassessment." });
    return el("section", { class: "box" }, [
      el("div", { class: "box-head" }, [el("h2", null, el("label", { for: "note-input", text: "Internal notes" })), el("span", { class: "badge", text: "Private" })]),
      ta,
      el("div", { class: "decide note-actions" }, el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => {
        const text = ta.value.trim();
        if (!text) return;
        Store.addNote(id, text);
        Store.log(id, "note_added");
        refresh();
      } }, "Add note")),
      notes.length ? el("ul", { class: "notes" }, notes.slice().reverse().map((n) => el("li", null, [el("p", { text: n.text }), el("time", { class: "act-time", text: dateTime(n.at) })])))
        : el("p", { class: "muted small", text: "No notes yet." })
    ]);
  }

  function historyPanel(id) {
    const runs = Store.runs(id);
    return el("section", { class: "box" }, [
      el("div", { class: "box-head" }, el("h2", { text: "Investigation history" })),
      runs.length ? el("ul", { class: "runs" }, runs.map((run, i) => el("li", null, [
        el("div", null, [
          el("b", { text: i === 0 ? "Latest" : "Run " + (runs.length - i) }),
          el("span", { class: "muted small", text: " · " + dateTime(run.at) }),
          el("p", { class: "small", text: run.reason + ": " + VERDICTS[run.verdict] + ", " + String(run.confidence).toLowerCase() + " confidence" })
        ]),
        el("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => openViewer("Investigation from " + dateTime(run.at), reportNodes(normalizeBrief(JSON.parse(JSON.stringify(run.brief))), true), run.reason) }, "View")
      ]))) : el("p", { class: "muted small", text: "Completed investigations are kept here, so you can compare runs." })
    ]);
  }

  // ---------- tab: evidence ----------

  function docRow(d, id) {
    const removable = !d.demo;
    return el("li", { class: "doc-row" }, [
      el("span", { class: "doc-icon" }, icon(d.kind === "image" ? "records" : "dispute")),
      el("div", { class: "doc-main" }, [
        el("span", { class: "doc-name", text: d.name }),
        el("span", { class: "doc-meta" }, [
          CATEGORY[d.category] || "Other", " · ",
          d.demo ? "Sample document" : "Uploaded by you", " · ",
          date(d.date || d.fileDate || d.addedAt)
        ])
      ]),
      d.demo ? el("span", { class: "badge", text: "Sample" }) : basisChip("SELLER_PROVIDED"),
      el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => previewDoc(d) }, "Preview"),
      removable ? el("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: async () => {
        if (!(await confirmStep("Remove " + d.name + "?", "It's deleted from this browser. Investigations that already used it keep their findings.", "Remove"))) return;
        await Docs.remove(d.id);
        Store.log(id, "document_removed", d.name);
        loadDocs(id);
      } }, "Remove") : null
    ]);
  }

  function renderEvidence(host) {
    const id = state.currentId;
    const cd = state.caseData;
    const brief = state.briefs[id] ? normalizeBrief(state.briefs[id]) : null;
    const docs = allDocs(id);
    const cat = el("select", { id: "upload-cat", "aria-label": "Document type" }, Object.entries(CATEGORY).map(([k, v]) => el("option", { value: k }, v)));
    const records = cd.sample ? null : (() => {
      const ta = el("textarea", { id: "records-input", rows: "6", maxlength: "20000", placeholder: "Tracking events, emails with the buyer, your policies, past orders from this customer..." });
      ta.value = state.records[id] || "";
      ta.addEventListener("input", () => { state.records[id] = ta.value; });
      return el("section", { class: "box" }, [
        el("div", { class: "box-head" }, [el("h2", null, el("label", { for: "records-input", text: "Records you pasted" })), basisChip("SELLER_PROVIDED")]),
        el("p", { class: "box-hint", text: "Anything you paste here is seller-provided. The agent reads it in the shipping stage." }),
        ta
      ]);
    })();

    const virtual = [
      { name: "PayPal dispute record", source: "PAYPAL_DISPUTE", basis: "VERIFIED_SOURCE" },
      { name: "PayPal order record", source: "PAYPAL_ORDER", basis: cd.order ? "VERIFIED_SOURCE" : "MISSING" }
    ];

    const assess = brief ? brief.evidence_assessment : [];
    const counts = {};
    assess.forEach((e) => { counts[e.rating] = (counts[e.rating] || 0) + 1; });

    host.replaceChildren(...[
      el("section", { class: "box" }, [
        el("div", { class: "box-head" }, [el("h2", { text: "Documents" }), el("span", { class: "muted small", text: docs.length + " document" + (docs.length === 1 ? "" : "s") })]),
        el("div", { class: "upload-row" }, [
          cat,
          el("button", { type: "button", class: "btn btn-primary", onclick: () => pickFile(cat.value) }, "Upload document"),
          el("span", { class: "muted small", text: "Photos, PDFs (up to 2 MB) or text files. Kept in this browser and sent to the AI only when you run an investigation." })
        ]),
        flashBox(id),
        el("ul", { class: "docs" }, [
          ...virtual.map((v) => el("li", { class: "doc-row" }, [
            el("span", { class: "doc-icon" }, icon(v.source === "PAYPAL_ORDER" ? "order" : "dispute")),
            el("div", { class: "doc-main" }, [el("span", { class: "doc-name", text: v.name }), el("span", { class: "doc-meta", text: "Retrieved from PayPal" + (cd.sample ? " (sample data)" : "") })]),
            basisChip(v.basis),
            el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => viewSource(v.source) }, "Preview")
          ])),
          ...docs.map((d) => docRow(d, id))
        ])
      ]),
      records,
      el("section", { class: "box" }, [
        el("div", { class: "box-head" }, [el("h2", { text: "Evidence strength assessment" }),
          el("div", { class: "mini-counts" }, Object.keys(RATING).map((k) => el("span", { class: "badge " + RATING[k][1], text: (counts[k] || 0) + " " + RATING[k][0].toLowerCase() })))]),
        el("p", { class: "notice notice-info", text: "These ratings are the AI's assessment of how well each item supports your case. They are not proof that a document is authentic." }),
        !brief ? el("p", { class: "empty-state", text: "Run the investigation to rate each piece of evidence." }) :
          el("div", { class: "ev-cards" }, assess.map((e, i) => {
            const [rl, rt] = RATING[e.rating];
            const doc = e.document_id ? docById(id, e.document_id) : null;
            return el("article", { class: "ev-card " + e.rating.toLowerCase() }, [
              el("div", { class: "ev-card-head" }, [
                el("div", null, [el("b", { class: "ev-name", text: e.name }), el("span", { class: "doc-meta", text: (CATEGORY[e.category] || "Other") + " · " + (doc ? doc.name : SOURCE[e.source]) + (e.date ? " · " + e.date : "") })]),
                el("span", { class: "badge rating " + rt, text: rl })
              ]),
              el("dl", { class: "criteria" }, [
                ["Relevance", LEVEL[e.relevance]], ["Source reliability", LEVEL[e.reliability]],
                ["Verification", { VERIFIED_BY_PAYPAL: "Verified by PayPal", SELLER_PROVIDED: "Seller-provided", UNVERIFIED: "Unverified" }[e.verification]],
                ["Completeness", { COMPLETE: "Complete", PARTIAL: "Partial", INCOMPLETE: "Incomplete" }[e.completeness]],
                ["Consistency", { CONSISTENT: "Consistent", MIXED: "Mixed", CONFLICTING: "Conflicting", NOT_CHECKED: "Not checked" }[e.consistency]]
              ].map(([k, v]) => el("div", null, [el("dt", { text: k }), el("dd", { text: v })]))),
              el("p", { class: "ev-expl" }, [basisChip("AI_INTERPRETATION"), " ", e.explanation]),
              el("div", { class: "decide" }, [
                el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => viewSource(e.source, e.document_id) }, "Preview source"),
                flagControl(brief, "evidence:" + i, "Evidence rating: " + e.name + " rated " + rl.toLowerCase())
              ])
            ]);
          }))
      ])
    ].filter(Boolean));
  }

  // ---------- tab: missing evidence ----------

  function renderMissing(host) {
    const id = state.currentId;
    const brief = state.briefs[id] ? normalizeBrief(state.briefs[id]) : null;
    if (!brief) {
      host.replaceChildren(el("section", { class: "box" }, el("p", { class: "empty-state", text: "Run the investigation to find evidence gaps." })));
      return;
    }
    const fresh = newEvidenceSince(id, brief);
    host.replaceChildren(...[
      fresh.length ? el("div", { class: "notice notice-warn" }, [
        "New evidence added: " + fresh.map((d) => d.name).join(", ") + ". ",
        el("button", { type: "button", class: "link-btn", onclick: () => askReassess("New evidence added") }, "Rerun the analysis")
      ]) : null,
      flashBox(id),
      brief.missing.length ? el("div", { class: "gap-cards" }, brief.missing.map((m, i) => el("article", { class: "box gap-card" }, [
        el("div", { class: "box-head" }, [el("h2", { text: m.item }), basisChip("MISSING")]),
        el("dl", { class: "gap-dl" }, [
          ["Why it matters", m.why_it_matters], ["How it would help", m.how_it_helps], ["Where to get it", m.where_to_get]
        ].filter(([, v]) => v).map(([k, v]) => el("div", null, [el("dt", { text: k }), el("dd", { text: v })]))),
        el("div", { class: "decide" }, [
          el("button", { type: "button", class: "btn btn-primary btn-sm", onclick: () => pickFile(m.category) }, "Upload " + (CATEGORY[m.category] || "document").toLowerCase()),
          flagControl(brief, "missing:" + i, "Missing evidence: " + m.item)
        ])
      ]))) : el("section", { class: "box" }, el("p", { class: "empty-state", text: "The agent didn't find any evidence gaps." }))
    ].filter(Boolean));
  }

  // ---------- tab: contradictions ----------

  function renderContradictions(host) {
    const id = state.currentId;
    const cd = state.caseData;
    const brief = state.briefs[id] ? normalizeBrief(state.briefs[id]) : null;
    if (!brief || !brief.claims.length) {
      host.replaceChildren(el("section", { class: "box" }, el("p", { class: "empty-state", text: brief ? "No buyer claims were identified." : "Run the investigation to compare the buyer's claims with your evidence." })));
      return;
    }
    const counts = {};
    brief.claims.forEach((c) => { counts[c.finding] = (counts[c.finding] || 0) + 1; });
    const said = (cd.dispute.messages || []).filter((m) => m.posted_by !== "SELLER").map((m) => String(m.content || ""));
    host.replaceChildren(el("section", { class: "box" }, [
      el("div", { class: "box-head" }, [el("h2", { text: "Contradiction finder" }),
        el("div", { class: "mini-counts" }, Object.keys(FINDING).map((k) => el("span", { class: "badge " + FINDING[k][1], text: (counts[k] || 0) + " " + FINDING[k][0].toLowerCase() })))]),
      el("div", { class: "cmp-head", "aria-hidden": "true" }, [el("span", { text: "Buyer's claims" }), el("span", { text: "Seller's evidence" })]),
      el("ol", { class: "cmp" }, brief.claims.map((c, i) => {
        const [fl, ft] = FINDING[c.finding];
        const quoted = c.claim.length > 8 && said.some((s) => s.includes(c.claim.replace(/[.\s]+$/, "")));
        const check = excerptCheck(cd, c);
        const doc = c.document_id ? docById(id, c.document_id) : null;
        return el("li", { class: "cmp-row" }, [
          el("div", { class: "cmp-claim" }, [
            el("p", { class: "claim-text" + (quoted ? " quoted" : ""), text: c.claim }),
            el("span", { class: "muted small", text: c.claim_basis === "BUYER_MESSAGE" ? "From the buyer's message" : "Implied by the dispute reason" })
          ]),
          el("div", { class: "cmp-mid" }, el("span", { class: "badge " + ft, text: fl })),
          el("div", { class: "cmp-ev" }, [
            el("p", { text: c.evidence }),
            el("span", { class: "muted small", text: "Source: " + (doc ? doc.name : SOURCE[c.source]) })
          ]),
          el("details", { class: "cmp-more" }, [
            el("summary", { text: "Inspect the evidence" }),
            el("div", { class: "cmp-detail" }, [
              el("p", null, [basisChip("AI_INTERPRETATION"), " ", c.explanation || "No explanation given."]),
              c.excerpt ? el("blockquote", { class: "excerpt" }, [el("p", { text: c.excerpt }), check ? el("span", { class: "ex-check " + check.state, text: check.text }) : null]) : el("p", { class: "muted small", text: "No exact quote was given for this finding." }),
              el("div", { class: "decide" }, [
                el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => viewSource(c.source, c.document_id) }, "View source"),
                flagControl(brief, "claim:" + i, "Claim “" + c.claim + "” marked " + fl.toLowerCase())
              ])
            ])
          ])
        ]);
      }))
    ]));
  }

  // ---------- tab: summary report ----------

  function reportStatus(id, brief) {
    const r = live[id];
    if (r && r.status === "running") return ["In progress", "info"];
    if (r && r.status === "paused") return ["Paused", "warn"];
    if (!brief) return ["Not started", ""];
    if (newEvidenceSince(id, brief).length || brief._flags.length) return ["Complete, reassessment suggested", "warn"];
    return ["Complete", "good"];
  }

  function reportNodes(brief, archived) {
    const cd = state.caseData;
    const d = cd.dispute;
    const tx = (d.disputed_transactions || [])[0] || {};
    const metas = stageStateFor(brief._trace || [], false);
    const section = (title, nodes) => el("section", { class: "rep-sec" }, [el("h3", { text: title }), ...[].concat(nodes)]);
    const counts = {};
    brief.evidence_assessment.forEach((e) => { counts[e.rating] = (counts[e.rating] || 0) + 1; });
    return [
      el("p", { class: "notice notice-info", text: "AI-generated report" + (cd.sample ? " on a sample case" : "") + ". Check it against the sources before relying on it." + (archived ? " This is an earlier run." : "") }),
      section("1. Dispute overview", el("dl", { class: "details-strip" }, [
        ["Customer", (tx.buyer && tx.buyer.name) || "Not listed"], ["Dispute ID", d.dispute_id], ["Category", REASONS[d.reason] || "Other"],
        ["Amount", money(d.dispute_amount)], ["Opened", date(d.create_time)], ["Response deadline", dateTime(d.seller_response_due_date) || "Not listed"],
        ["Investigated", dateTime(brief._at) + (brief._reason ? " (" + brief._reason + ")" : "")]
      ].map(([k, v]) => el("div", null, [el("dt", { text: k }), el("dd", { text: v })])))),
      section("2. Buyer's claims", el("ul", null, brief.claims.map((c) => el("li", { text: c.claim })))),
      section("3. Information retrieved", el("ul", { class: "rep-stages" }, metas.map((s) => el("li", null, [
        el("b", { text: s.def.title + ": " }), el("span", { class: "badge " + STATUS[s.status][1], text: STATUS[s.status][0] }),
        s.meta && s.meta.retrieved.length ? el("span", { class: "muted small", text: " " + s.meta.retrieved.join("; ") }) : null
      ])))),
      section("4. Evidence collected", el("ul", null, metas.flatMap((s) => (s.meta ? s.meta.evidence : []).map((e) => el("li", null, [basisChip(e.basis), " ", e.label]))))),
      section("5. Evidence strength", [
        el("p", { text: Object.keys(RATING).map((k) => (counts[k] || 0) + " " + RATING[k][0].toLowerCase()).join(" · ") }),
        el("ul", null, brief.evidence_assessment.map((e) => el("li", null, [el("span", { class: "badge " + RATING[e.rating][1], text: RATING[e.rating][0] }), " " + e.name + ": " + e.explanation])))
      ]),
      section("6. Contradictions identified", el("ul", null, brief.claims.map((c) => el("li", null, [el("span", { class: "badge " + FINDING[c.finding][1], text: FINDING[c.finding][0] }), " " + c.claim + " " + c.evidence])))),
      section("7. Missing evidence", brief.missing.length ? el("ul", null, brief.missing.map((m) => el("li", { text: m.item + (m.why_it_matters ? ": " + m.why_it_matters : "") }))) : el("p", { class: "muted", text: "None identified." })),
      section("8. Weaknesses in the seller's case", brief.weaknesses.length ? el("ul", null, brief.weaknesses.map((w) => el("li", { text: w }))) : el("p", { class: "muted", text: "None identified." })),
      section("9. Overall findings", [
        el("p", null, [el("b", { text: VERDICTS[brief.verdict] + ", " + brief.confidence.toLowerCase() + " confidence. " }), brief.headline]),
        el("p", { text: brief.reasoning })
      ])
    ];
  }

  function reportText(brief) {
    const cd = state.caseData;
    const d = cd.dispute;
    const lines = ["CASEFILE INVESTIGATION SUMMARY (AI-generated, check before relying on it)", "Dispute " + d.dispute_id + " · " + (REASONS[d.reason] || "") + " · " + money(d.dispute_amount), "Investigated " + dateTime(brief._at), "",
      "RECOMMENDATION: " + VERDICTS[brief.verdict] + " (" + brief.confidence.toLowerCase() + " confidence)", brief.headline, brief.reasoning, "",
      "BUYER'S CLAIMS"];
    brief.claims.forEach((c) => lines.push("- " + c.claim + " -> " + FINDING[c.finding][0] + ": " + c.evidence));
    lines.push("", "EVIDENCE STRENGTH");
    brief.evidence_assessment.forEach((e) => lines.push("- " + e.name + ": " + RATING[e.rating][0] + ". " + e.explanation));
    lines.push("", "MISSING EVIDENCE");
    brief.missing.forEach((m) => lines.push("- " + m.item));
    lines.push("", "WEAKNESSES");
    brief.weaknesses.forEach((w) => lines.push("- " + w));
    return lines.join("\n");
  }

  function renderSummary(host) {
    const id = state.currentId;
    const brief = state.briefs[id] ? normalizeBrief(state.briefs[id]) : null;
    const [label, tone] = reportStatus(id, brief);
    if (!brief) {
      host.replaceChildren(el("section", { class: "box" }, [
        el("div", { class: "box-head" }, [el("h2", { text: "Investigation summary" }), el("span", { class: "badge " + tone, text: label })]),
        el("p", { class: "empty-state", text: "The report is generated when the investigation finishes." })
      ]));
      return;
    }
    const copied = el("span", { class: "muted small", role: "status" });
    host.replaceChildren(el("section", { class: "box report" }, [
      el("div", { class: "box-head" }, [el("h2", { text: "Investigation summary" }), el("div", { class: "box-head-right" }, [
        el("span", { class: "badge " + tone, text: "Status: " + label }),
        el("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => {
          const text = reportText(brief);
          Promise.resolve().then(() => navigator.clipboard.writeText(text)).then(() => { copied.textContent = "Copied"; }).catch(() => { copied.textContent = "Couldn't copy. Select the text instead."; });
        } }, "Copy report"),
        copied
      ])]),
      ...reportNodes(brief, false)
    ]));
  }

  // ---------- tabs ----------

  const TABS = [
    ["overview", "Overview"], ["investigation", "Investigation"], ["evidence", "Evidence"],
    ["contradictions", "Contradictions"], ["missing", "Missing evidence"], ["summary", "Summary"], ["response", "Response"]
  ];
  const currentTab = {};
  function tabOf(id) { return currentTab[id] || "overview"; }
  function setTab(tab) {
    currentTab[state.currentId] = tab;
    refresh();
    const bar = document.querySelector(".tabs");
    if (bar) bar.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function tabBar(id) {
    const brief = state.briefs[id] ? normalizeBrief(state.briefs[id]) : null;
    const counts = {
      evidence: allDocs(id).length || null,
      contradictions: brief ? brief.claims.filter((c) => c.finding === "CONTRADICTED").length || null : null,
      missing: brief ? brief.missing.length || null : null
    };
    const r = live[id];
    return el("div", { class: "tabs", role: "tablist", "aria-label": "Case sections" }, TABS.map(([key, label]) => el("button", {
      type: "button", role: "tab", class: "tab", "aria-selected": tabOf(id) === key ? "true" : "false",
      onclick: () => setTab(key)
    }, [label,
      key === "investigation" && r && r.status === "running" ? el("span", { class: "live-dot", "aria-label": "running" }) : null,
      counts[key] ? el("span", { class: "tab-count mono", text: String(counts[key]) }) : null])));
  }

  // Re-render the open case without losing the page position.
  function refresh() {
    if (!state.caseData || $("case-view").hidden) return;
    const y = window.scrollY;
    renderCase();
    window.scrollTo(0, y);
  }

  function renderTab(host) {
    const id = state.currentId;
    const tab = tabOf(id);
    if (tab === "investigation") renderInvestigation(host);
    else if (tab === "evidence") renderEvidence(host);
    else if (tab === "contradictions") renderContradictions(host);
    else if (tab === "missing") renderMissing(host);
    else if (tab === "summary") renderSummary(host);
  }

  return { normalizeBrief, loadDocs, tabBar, tabOf, setTab, renderTab, start, live, refresh, newEvidenceSince, uploaded };
})();
