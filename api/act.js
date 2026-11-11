// POST /api/act  { dispute_id, action, ... }
// Carries out the step the seller approved. Nothing reaches PayPal until the seller clicks a button.
//   action "provide_evidence"  { response_note, evidence: [...] }
//   action "accept_claim"      { note }
//   action "make_offer"        { note, amount, currency }
//   action "send_message"      { message }
//   action "escalate"          { note? }                                    (sandbox only: inquiry -> claim)
//   action "adjudicate"        { outcome: "SELLER_FAVOR" | "BUYER_FAVOR" }   (sandbox only)
// Sample cases (DEMO-...) are simulated and never touch PayPal.

const { send, allowed, onlyMethod, body, ID_PATTERN } = require("./_lib/http");
const paypal = require("./_lib/paypal");
const demo = require("./_lib/demo-data");

const CARRIERS = ["USPS", "UPS", "FEDEX", "DHL", "OTHER"];

function text(v, max) {
  return String(v == null ? "" : v).trim().slice(0, max);
}

// PayPal accepts only certain evidence types for each dispute reason
// (developer.paypal.com/disputes/reasons-evidence). Proof of refund needs a refund ID,
// which a fight never has, so it is never used here.
//   Item not received: PROOF_OF_FULFILLMENT, with tracking, or with notes alone.
//   Unauthorised:      PROOF_OF_FULFILLMENT with tracking, and OTHER for notes.
//   Every other reason: OTHER, notes only.
const FULFILLMENT_REASONS = ["MERCHANDISE_OR_SERVICE_NOT_RECEIVED"];
const TRACKING_PLUS_NOTES_REASONS = ["UNAUTHORISED", "UNAUTHORIZED"];
const TYPE_LABELS = {
  PROOF_OF_FULFILLMENT: "Proof of delivery", PROOF_OF_DELIVERY_SIGNATURE: "Delivery signature", PROOF_OF_REFUND: "Proof of refund",
  PROOF_OF_RECEIPT_COPY: "Receipt copy", RETURN_POLICY: "Return policy", ITEM_DESCRIPTION: "Item description",
  PROOF_OF_RESHIPMENT: "Proof of reshipment", OTHER: "Supporting information"
};

// Turn the reviewed brief into the evidences array PayPal accepts for this dispute's reason.
// Everything the seller approved is kept: the written response comes first, then each evidence
// item's summary, then the tracking details. Nothing is added that the seller didn't approve.
function buildEvidences(list, responseNote, reason) {
  const items = (Array.isArray(list) ? list : []).filter((e) => e && /^[A-Z_]{3,60}$/.test(text(e.evidence_type, 60)));
  let tracking = null;
  for (const e of items) {
    const number = text(e.tracking_number, 60).replace(/\s+/g, "");
    if (number && CARRIERS.includes(e.carrier)) {
      tracking = { carrier_name: e.carrier, tracking_number: number };
      if (e.carrier === "OTHER") tracking.carrier_name_other = text(e.carrier_other_name, 60) || "Other";
      break;
    }
  }
  const note = text(responseNote, 2000);
  const summaries = items.map((e) => {
    const s = text(e.summary, 1000);
    return s ? (TYPE_LABELS[e.evidence_type] || "Evidence") + ": " + s : "";
  }).filter((s) => s && s !== note);
  const trackingLine = tracking ? "Tracking: " + (tracking.carrier_name_other || tracking.carrier_name) + " " + tracking.tracking_number : "";
  const notesWith = (extra) => text([note].concat(summaries, extra ? [extra] : []).filter(Boolean).join("\n\n"), 2000);

  const r = String(reason || "").toUpperCase();
  if (FULFILLMENT_REASONS.includes(r)) {
    const item = { evidence_type: "PROOF_OF_FULFILLMENT", notes: notesWith(tracking ? "" : trackingLine) };
    if (tracking) item.evidence_info = { tracking_info: [tracking] };
    return [item];
  }
  if (TRACKING_PLUS_NOTES_REASONS.includes(r) && tracking) {
    return [
      { evidence_type: "PROOF_OF_FULFILLMENT", notes: text(trackingLine, 2000), evidence_info: { tracking_info: [tracking] } },
      { evidence_type: "OTHER", notes: notesWith("") }
    ];
  }
  return [{ evidence_type: "OTHER", notes: notesWith(trackingLine) }];
}

// If PayPal still refuses the type (for example a reason it reports differently), try once with the
// other notes-only type. Same content, different label.
function alternateEvidences(evidences) {
  const notes = text(evidences.map((e) => e.notes).filter(Boolean).join("\n\n"), 2000);
  const usedFulfillment = evidences.some((e) => e.evidence_type === "PROOF_OF_FULFILLMENT");
  const tracked = evidences.find((e) => e.evidence_info);
  if (usedFulfillment) return [{ evidence_type: "OTHER", notes }];
  const item = { evidence_type: "PROOF_OF_FULFILLMENT", notes };
  if (tracked) item.evidence_info = tracked.evidence_info;
  return [item];
}

async function submitEvidence(id, list, responseNote) {
  let reason = "";
  try { reason = (await paypal.getDispute(id)).reason || ""; } catch (e) { /* fall back to the notes-only type */ }
  const evidences = buildEvidences(list, responseNote, reason);
  try {
    await paypal.provideEvidence(id, evidences);
    return { adjusted: false };
  } catch (e) {
    if (!(e.issues || []).includes("EVIDENCE_TYPE_IS_NOT_ALLOWED")) throw e;
    await paypal.provideEvidence(id, alternateEvidences(evidences));
    return { adjusted: true };
  }
}

module.exports = async function handler(req, res) {
  if (!onlyMethod(req, res, "POST") || !allowed(req, res)) return;
  const input = body(req);
  const id = String(input.dispute_id || "");
  const action = String(input.action || "");
  if (!ID_PATTERN.test(id)) {
    send(res, 400, { error: "Invalid dispute ID" });
    return;
  }

  // Validate first, so sample cases and real ones reject the same bad input.
  let run;
  let done;
  if (action === "provide_evidence") {
    if (!text(input.response_note, 2000)) {
      send(res, 400, { error: "Add a written response before submitting." });
      return;
    }
    run = async () => {
      const r = await submitEvidence(id, input.evidence, input.response_note);
      if (r.adjusted) done = "Evidence submitted under a different evidence type that PayPal accepts for this case. Your response and notes were sent unchanged. PayPal will review the case.";
    };
    done = "Evidence submitted. PayPal will review the case.";
  } else if (action === "accept_claim") {
    const note = text(input.note, 2000) || "Refund accepted.";
    run = () => paypal.acceptClaim(id, note);
    done = "Claim accepted. PayPal will refund the buyer.";
  } else if (action === "make_offer") {
    const amount = text(input.amount, 12);
    const currency = text(input.currency, 3).toUpperCase() || "USD";
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || !/^[A-Z]{3}$/.test(currency)) {
      send(res, 400, { error: "Enter a valid offer amount." });
      return;
    }
    const note = text(input.note, 2000) || "Partial refund offered.";
    run = () => paypal.makeOffer(id, note, { currency_code: currency, value: amount });
    done = "Offer of " + amount + " " + currency + " sent to the buyer.";
  } else if (action === "send_message") {
    const message = text(input.message, 2000);
    if (!message) {
      send(res, 400, { error: "Write a message first." });
      return;
    }
    run = () => paypal.sendMessage(id, message);
    done = "Message sent to the buyer.";
  } else if (action === "escalate") {
    if (paypal.environment() !== "sandbox") {
      send(res, 400, { error: "Escalating from Casefile is only enabled in the PayPal sandbox." });
      return;
    }
    const note = text(input.note, 2000) || "Escalating to a claim so PayPal can review the evidence.";
    run = () => paypal.escalate(id, note);
    done = "Escalated to a PayPal claim.";
  } else if (action === "adjudicate") {
    const outcome = input.outcome === "BUYER_FAVOR" ? "BUYER_FAVOR" : "SELLER_FAVOR";
    if (paypal.environment() !== "sandbox") {
      send(res, 400, { error: "Simulated decisions only work in the PayPal sandbox." });
      return;
    }
    run = () => paypal.adjudicate(id, outcome);
    done = outcome === "SELLER_FAVOR" ? "Sandbox decision: resolved in your favor." : "Sandbox decision: resolved in the buyer's favor.";
  } else {
    send(res, 400, { error: "Unknown action" });
    return;
  }

  if (demo.isDemo(id)) {
    send(res, 200, { ok: true, sample: true, message: "Sample case: nothing was sent to PayPal. On a real case: " + done });
    return;
  }
  if (!paypal.configured()) {
    send(res, 400, { error: "PayPal is not connected." });
    return;
  }

  try {
    await run();
    let dispute = null;
    try {
      const fresh = await paypal.getDispute(id);
      dispute = { status: fresh.status, actions: paypal.allowedActions(fresh) };
    } catch (e) { /* the action worked; a refresh failure isn't worth reporting as an error */ }
    send(res, 200, { ok: true, sample: false, message: done, dispute });
  } catch (e) {
    send(res, e.status >= 400 && e.status < 500 ? 422 : 502, {
      error: "PayPal said: " + e.message,
      debug_id: e.debugId || null
    });
  }
};
