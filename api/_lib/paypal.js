// Minimal PayPal REST client: OAuth token, Disputes v1, Payments v2 captures, Orders v2.
// Credentials come from Vercel environment variables and never reach the browser.

const BASES = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com"
};

function environment() {
  return process.env.PAYPAL_ENV === "live" ? "live" : "sandbox";
}

function configured() {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

class PayPalError extends Error {
  constructor(status, data) {
    const detail = data && Array.isArray(data.details) && data.details[0]
      ? " (" + [data.details[0].issue, data.details[0].description].filter(Boolean).join(": ") + ")"
      : "";
    super(((data && (data.message || data.error_description)) || "PayPal request failed") + detail);
    this.status = status;
    this.paypalName = data && (data.name || data.error);
    this.debugId = data && data.debug_id;
  }
}

let cachedToken = null;

async function accessToken() {
  if (cachedToken && cachedToken.expires > Date.now() + 60000) return cachedToken.value;
  const basic = Buffer.from(process.env.PAYPAL_CLIENT_ID + ":" + process.env.PAYPAL_CLIENT_SECRET).toString("base64");
  const r = await fetch(BASES[environment()] + "/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: "Basic " + basic, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10000)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) throw new PayPalError(r.status, data);
  cachedToken = { value: data.access_token, expires: Date.now() + (Number(data.expires_in) || 300) * 1000 };
  return cachedToken.value;
}

async function request(method, path, options) {
  const opts = options || {};
  const headers = { Authorization: "Bearer " + (await accessToken()), Accept: "application/json" };
  let payload;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(opts.json);
  } else if (opts.multipart) {
    headers["Content-Type"] = opts.multipart.contentType;
    payload = opts.multipart.body;
  }
  const r = await fetch(BASES[environment()] + path, {
    method,
    headers,
    body: payload,
    signal: AbortSignal.timeout(15000)
  });
  const text = await r.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch (e) { data = { message: text.slice(0, 300) }; }
  }
  if (!r.ok) throw new PayPalError(r.status, data);
  return data;
}

const enc = encodeURIComponent;

// ---- Disputes v1 ----

function listDisputes() {
  return request("GET", "/v1/customer/disputes?page_size=20");
}

function getDispute(id) {
  return request("GET", "/v1/customer/disputes/" + enc(id));
}

// provide-evidence takes multipart/form-data with a JSON part named "input".
// Built by hand so the part carries Content-Type: application/json and no filename,
// matching PayPal's documented curl example (-F 'input={...};type=application/json').
function provideEvidence(id, evidences) {
  const boundary = "casefile" + Date.now().toString(36) + Math.random().toString(36).slice(2);
  const body =
    "--" + boundary + "\r\n" +
    'Content-Disposition: form-data; name="input"\r\n' +
    "Content-Type: application/json\r\n\r\n" +
    JSON.stringify({ evidences }) + "\r\n" +
    "--" + boundary + "--\r\n";
  return request("POST", "/v1/customer/disputes/" + enc(id) + "/provide-evidence", {
    multipart: { contentType: "multipart/form-data; boundary=" + boundary, body }
  });
}

function acceptClaim(id, note) {
  return request("POST", "/v1/customer/disputes/" + enc(id) + "/accept-claim", { json: { note } });
}

function makeOffer(id, note, amount) {
  return request("POST", "/v1/customer/disputes/" + enc(id) + "/make-offer", {
    json: { note, offer_amount: amount, offer_type: "REFUND" }
  });
}

function sendMessage(id, message) {
  return request("POST", "/v1/customer/disputes/" + enc(id) + "/send-message", { json: { message } });
}

// Sandbox only: lets you play PayPal's part so the demo can reach a final decision.
function adjudicate(id, outcome) {
  return request("POST", "/v1/customer/disputes/" + enc(id) + "/adjudicate", { json: { adjudication_outcome: outcome } });
}

// ---- Payments v2 / Orders v2 ----

// For Orders v2 checkouts, the dispute's seller_transaction_id is the capture ID.
async function getOrderForTransaction(transactionId) {
  const capture = await request("GET", "/v2/payments/captures/" + enc(transactionId));
  let orderId = capture.supplementary_data && capture.supplementary_data.related_ids &&
    capture.supplementary_data.related_ids.order_id;
  if (!orderId && Array.isArray(capture.links)) {
    const up = capture.links.find((l) => l.rel === "up" && /\/checkout\/orders\//.test(l.href || ""));
    if (up) orderId = up.href.split("/checkout/orders/")[1].split(/[/?]/)[0];
  }
  const order = orderId ? await request("GET", "/v2/checkout/orders/" + enc(orderId)) : null;
  return { capture, order };
}

// Demo store checkout. The JS SDK button asks our server to create the order,
// the buyer approves in PayPal's window, then our server captures it.
function createOrder(priced, reference) {
  return request("POST", "/v2/checkout/orders", {
    json: {
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: reference,
        description: "Ember & Wick demo order (sandbox)",
        amount: {
          currency_code: "USD",
          value: priced.total,
          breakdown: {
            item_total: { currency_code: "USD", value: priced.itemTotal },
            shipping: { currency_code: "USD", value: priced.shipping }
          }
        },
        items: priced.items
      }]
    }
  });
}

function captureOrder(orderId) {
  return request("POST", "/v2/checkout/orders/" + enc(orderId) + "/capture", { json: {} });
}

function getOrder(orderId) {
  return request("GET", "/v2/checkout/orders/" + enc(orderId));
}

// Attach shipment tracking to the order. PayPal stores it with the order,
// which is the strongest proof of delivery a seller can have in a dispute.
function addTracking(orderId, captureId, carrier, trackingNumber) {
  return request("POST", "/v2/checkout/orders/" + enc(orderId) + "/track", {
    json: { capture_id: captureId, tracking_number: trackingNumber, carrier, notify_payer: false }
  });
}

// Strip HATEOAS links and other bulk the model doesn't need.
function slim(value) {
  if (Array.isArray(value)) return value.map(slim);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "links") continue;
      out[k] = slim(v);
    }
    return out;
  }
  return value;
}

// Which actions PayPal currently allows on this dispute, read from its links.
function allowedActions(dispute) {
  const rels = new Set();
  for (const l of (dispute && dispute.links) || []) {
    if (l && l.rel) rels.add(String(l.rel).toLowerCase().replace(/-/g, "_"));
  }
  return [...rels].filter((r) => r !== "self");
}

module.exports = {
  environment, configured, PayPalError,
  listDisputes, getDispute, provideEvidence, acceptClaim, makeOffer, sendMessage, adjudicate,
  getOrderForTransaction, slim, allowedActions,
  createOrder, captureOrder, getOrder, addTracking
};
