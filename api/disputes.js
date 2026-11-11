// GET /api/disputes          -> sample cases plus disputes from your PayPal account (if connected)
// GET /api/disputes?id=XYZ   -> one dispute with its order and the actions PayPal allows right now
// Real disputes and sample cases are returned in the same summary shape, so the app treats them alike.
const { send, allowed, onlyMethod, ID_PATTERN } = require("./_lib/http");
const paypal = require("./_lib/paypal");
const demo = require("./_lib/demo-data");

const MAX_ENRICH = 25;

// Kept while this server instance stays warm, so a refresh only asks PayPal about disputes
// that are new or have changed since the last refresh.
const summaries = new Map();  // dispute_id -> { stamp, summary }
const orderIds = new Map();   // capture ID -> checkout order ID (never changes)
const stampOf = (item) => [item.update_time || "", item.status || "", item.dispute_state || ""].join("|");

// PayPal's list call returns only a few fields, so each new or changed dispute is fetched in full
// for the customer name, transaction and outcome; the order ID comes from the payment capture.
async function summarizeReal(item) {
  const stamp = stampOf(item);
  const known = summaries.get(item.dispute_id);
  if (known && known.stamp === stamp) return known.summary;
  let d = item;
  let complete = true;
  try { d = await paypal.getDispute(item.dispute_id); } catch (e) { complete = false; /* fall back to the list fields */ }
  const tx = (d.disputed_transactions || [])[0] || {};
  let orderId = null;
  if (tx.seller_transaction_id) {
    if (orderIds.has(tx.seller_transaction_id)) orderId = orderIds.get(tx.seller_transaction_id);
    else {
      try {
        orderId = await paypal.orderIdForTransaction(tx.seller_transaction_id);
        orderIds.set(tx.seller_transaction_id, orderId);
      } catch (e) { /* not every payment has a checkout order */ }
    }
  }
  const summary = buildSummary(d, tx, orderId);
  // Only remember a full answer, so a failed lookup is retried on the next refresh.
  if (complete) summaries.set(item.dispute_id, { stamp, summary });
  return summary;
}

function buildSummary(d, tx, orderId) {
  return {
    dispute_id: d.dispute_id,
    create_time: d.create_time,
    update_time: d.update_time || null,
    reason: d.reason,
    status: d.status,
    dispute_amount: d.dispute_amount,
    seller_response_due_date: d.seller_response_due_date || null,
    dispute_life_cycle_stage: d.dispute_life_cycle_stage || null,
    outcome: (d.dispute_outcome && d.dispute_outcome.outcome_code) || null,
    // PayPal doesn't give a separate resolution date; the last update of a resolved dispute is the closest.
    resolved_time: d.status === "RESOLVED" ? d.update_time || null : null,
    buyer_name: (tx.buyer && tx.buyer.name) || null,
    transaction_id: tx.seller_transaction_id || null,
    order_id: orderId,
    sample: false
  };
}

module.exports = async function handler(req, res) {
  if (!onlyMethod(req, res, "GET") || !allowed(req, res)) return;
  const id = String((req.query && req.query.id) || "");

  const mode = {
    paypal: paypal.configured(),
    env: paypal.environment(),
    ai: Boolean(process.env.ANTHROPIC_API_KEY)
  };

  if (!id) {
    const result = { mode, items: demo.listSummaries(), warning: null };
    if (mode.paypal) {
      try {
        const data = await paypal.listDisputes();
        const items = (data.items || []).slice(0, MAX_ENRICH);
        const real = await Promise.all(items.map(summarizeReal));
        result.items.push(...real);
      } catch (e) {
        result.warning = "Could not load disputes from PayPal: " + e.message;
      }
    }
    send(res, 200, result);
    return;
  }

  if (!ID_PATTERN.test(id)) {
    send(res, 400, { error: "Invalid dispute ID" });
    return;
  }

  if (demo.isDemo(id)) {
    const c = demo.getCase(id);
    if (!c) {
      send(res, 404, { error: "No such sample case" });
      return;
    }
    send(res, 200, {
      mode,
      sample: true,
      dispute: c.dispute,
      order: c.order,
      records: c.records,
      documents: demo.demoDocs(id),
      actions: ["provide_evidence", "accept_claim", "make_offer", "send_message"]
    });
    return;
  }

  if (!mode.paypal) {
    send(res, 400, { error: "PayPal is not connected. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in Vercel." });
    return;
  }
  try {
    const dispute = await paypal.getDispute(id);
    const tx = (dispute.disputed_transactions || [])[0] || {};
    let order = null;
    if (tx.seller_transaction_id) {
      try {
        const found = await paypal.getOrderForTransaction(tx.seller_transaction_id);
        order = found.order ? paypal.slim(found.order) : null;
      } catch (e) { /* the case page still works without the order */ }
    }
    send(res, 200, {
      mode,
      sample: false,
      dispute: paypal.slim(dispute),
      order,
      records: "",
      documents: [],
      actions: paypal.allowedActions(dispute)
    });
  } catch (e) {
    send(res, e.status === 404 ? 404 : 502, { error: e.message, debug_id: e.debugId || null });
  }
};
