// GET /api/disputes          -> sample cases plus disputes from your PayPal account (if connected)
// GET /api/disputes?id=XYZ   -> one dispute with its order and the actions PayPal allows right now
const { send, allowed, onlyMethod, ID_PATTERN } = require("./_lib/http");
const paypal = require("./_lib/paypal");
const demo = require("./_lib/demo-data");

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
        for (const d of data.items || []) {
          result.items.push({
            dispute_id: d.dispute_id,
            create_time: d.create_time,
            reason: d.reason,
            status: d.status,
            dispute_amount: d.dispute_amount,
            seller_response_due_date: d.seller_response_due_date || null,
            buyer_name: null,
            sample: false
          });
        }
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
    send(res, 200, {
      mode,
      sample: false,
      dispute: paypal.slim(dispute),
      order: null,
      records: "",
      actions: paypal.allowedActions(dispute)
    });
  } catch (e) {
    send(res, e.status === 404 ? 404 : 502, { error: e.message, debug_id: e.debugId || null });
  }
};
