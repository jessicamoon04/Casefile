// Demo store backend (sandbox only, so no real money can ever move).
//   GET  /api/checkout                                   -> { clientId, catalog, shipping } for the PayPal button
//   POST /api/checkout { action: "create", cart }         -> { id } PayPal order ID
//   POST /api/checkout { action: "capture", order_id }    -> capture result (capture ID = the dispute's transaction ID)
//   POST /api/checkout { action: "track", order_id, capture_id, carrier, tracking_number }
// Not behind ACCESS_CODE, so judges can buy from the store; the sandbox-only check limits what anyone can do.

const crypto = require("crypto");
const { send, body } = require("./_lib/http");
const paypal = require("./_lib/paypal");
const { CATALOG, SHIPPING, priceCart } = require("./_lib/catalog");

const ORDER_ID = /^[A-Z0-9]{10,30}$/;
const CARRIERS = ["USPS", "UPS", "FEDEX", "DHL"];

module.exports = async function handler(req, res) {
  if (!paypal.configured()) {
    send(res, 400, { error: "The demo store needs PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in Vercel." });
    return;
  }
  if (paypal.environment() !== "sandbox") {
    send(res, 403, { error: "The demo store only runs in the PayPal sandbox." });
    return;
  }

  if (req.method === "GET") {
    send(res, 200, {
      clientId: process.env.PAYPAL_CLIENT_ID,
      catalog: Object.entries(CATALOG).map(([sku, p]) => ({ sku, name: p.name, price: p.price })),
      shipping: SHIPPING
    });
    return;
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    send(res, 405, { error: "Method not allowed" });
    return;
  }

  const input = body(req);
  try {
    if (input.action === "create") {
      const priced = priceCart(input.cart);
      if (!priced) {
        send(res, 400, { error: "Your cart is empty or invalid." });
        return;
      }
      const order = await paypal.createOrder(priced, "EW-" + crypto.randomBytes(4).toString("hex").toUpperCase());
      send(res, 200, { id: order.id });
      return;
    }

    if (input.action === "capture") {
      const orderId = String(input.order_id || "");
      if (!ORDER_ID.test(orderId)) {
        send(res, 400, { error: "Invalid order ID" });
        return;
      }
      const result = await paypal.captureOrder(orderId);
      const unit = (result.purchase_units || [])[0] || {};
      const capture = ((unit.payments && unit.payments.captures) || [])[0] || {};
      const shipping = unit.shipping || {};
      send(res, 200, {
        status: result.status,
        order_id: result.id,
        capture_id: capture.id || null,
        capture_status: capture.status || null,
        amount: capture.amount || null,
        ship_to: shipping.name ? shipping.name.full_name : null,
        address: shipping.address || null
      });
      return;
    }

    if (input.action === "track") {
      const orderId = String(input.order_id || "");
      const captureId = String(input.capture_id || "");
      const carrier = String(input.carrier || "");
      const tracking = String(input.tracking_number || "").replace(/\s+/g, "");
      if (!ORDER_ID.test(orderId) || !ORDER_ID.test(captureId) || !CARRIERS.includes(carrier) || !/^[A-Za-z0-9]{6,40}$/.test(tracking)) {
        send(res, 400, { error: "Check the carrier and tracking number." });
        return;
      }
      await paypal.addTracking(orderId, captureId, carrier, tracking);
      send(res, 200, { ok: true });
      return;
    }

    send(res, 400, { error: "Unknown action" });
  } catch (e) {
    send(res, e.status >= 400 && e.status < 500 ? 422 : 502, { error: "PayPal said: " + e.message, debug_id: e.debugId || null });
  }
};
