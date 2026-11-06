// POST /api/act  { dispute_id, action, ... }
// Carries out the step the seller approved. Nothing reaches PayPal until the seller clicks a button.
//   action "provide_evidence"  { response_note, evidence: [...] }
//   action "accept_claim"      { note }
//   action "make_offer"        { note, amount, currency }
//   action "send_message"      { message }
//   action "adjudicate"        { outcome: "SELLER_FAVOR" | "BUYER_FAVOR" }   (sandbox only)
// Sample cases (DEMO-...) are simulated and never touch PayPal.

const { send, allowed, onlyMethod, body, ID_PATTERN } = require("./_lib/http");
const paypal = require("./_lib/paypal");
const demo = require("./_lib/demo-data");

const CARRIERS = ["USPS", "UPS", "FEDEX", "DHL", "OTHER"];

function text(v, max) {
  return String(v == null ? "" : v).trim().slice(0, max);
}

// Turn the reviewed brief into PayPal's evidences array.
// The full written response goes in the notes of the first item.
function buildEvidences(list, responseNote) {
  const evidences = [];
  for (const e of Array.isArray(list) ? list : []) {
    let type = text(e && e.evidence_type, 60);
    if (!/^[A-Z_]{3,60}$/.test(type)) continue;
    const tracking = text(e.tracking_number, 60).replace(/\s+/g, "");
    const hasTracking = Boolean(tracking) && CARRIERS.includes(e.carrier);
    // PayPal expects tracking details with proof of fulfillment; without them, send it as supporting info.
    if (type === "PROOF_OF_FULFILLMENT" && !hasTracking) type = "OTHER";
    const item = { evidence_type: type, notes: text(e.summary, 1000) };
    if (type === "PROOF_OF_FULFILLMENT") {
      const info = { carrier_name: e.carrier, tracking_number: tracking };
      if (e.carrier === "OTHER") info.carrier_name_other = text(e.carrier_other_name, 60) || "Other";
      item.evidence_info = { tracking_info: [info] };
    }
    evidences.push(item);
  }
  const note = text(responseNote, 2000);
  if (!evidences.length) evidences.push({ evidence_type: "OTHER", notes: note });
  else if (note) evidences[0].notes = note;
  return evidences.slice(0, 8);
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
    const evidences = buildEvidences(input.evidence, input.response_note);
    if (!evidences[0].notes) {
      send(res, 400, { error: "Add a written response before submitting." });
      return;
    }
    run = () => paypal.provideEvidence(id, evidences);
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
