// Shared helpers for the API routes. Files in api/ that start with "_" are not deployed as routes.
const crypto = require("crypto");

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
}

// Optional shared password. When ACCESS_CODE is set in Vercel, every API call must carry it,
// so strangers who find the URL can't spend your AI credits or act on your PayPal disputes.
function allowed(req, res) {
  const expected = process.env.ACCESS_CODE;
  if (!expected) return true;
  const given = String(req.headers["x-access-code"] || "");
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  if (crypto.timingSafeEqual(a, b)) return true;
  send(res, 401, { error: "Access code required", code: "ACCESS_CODE" });
  return false;
}

function onlyMethod(req, res, method) {
  if (req.method === method) return true;
  res.setHeader("Allow", method);
  send(res, 405, { error: "Method not allowed" });
  return false;
}

// Vercel parses JSON bodies for us, but be defensive about strings and empty bodies.
function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return {};
}

const ID_PATTERN = /^[A-Za-z0-9-]{3,64}$/;

module.exports = { send, allowed, onlyMethod, body, ID_PATTERN };
