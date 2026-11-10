// Checks the access code from the landing page before the app opens.
// Touches nothing else: no PayPal call, no AI call. Answers 401 when the code is missing or wrong.
const { send, allowed, onlyMethod } = require("./_lib/http");

module.exports = async (req, res) => {
  if (!onlyMethod(req, res, "POST")) return;
  if (!allowed(req, res)) return;
  send(res, 200, { ok: true, required: Boolean(process.env.ACCESS_CODE) });
};
