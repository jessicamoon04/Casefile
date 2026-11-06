# Casefile

**Dispute defense for PayPal sellers.** Casefile reads a PayPal dispute, pulls the PayPal order behind it and the seller's own records, decides whether the case is worth fighting, and drafts the evidence and written response. The seller edits and approves; only then does anything go to PayPal.

Built for the PayPal AI Hackathon (Devpost).

## How it works

0. **Demo store.** `shop.html` takes real PayPal sandbox payments (JS SDK buttons + Orders v2 create/capture/track), so you can create genuine disputes to test with.
1. **Inbox.** `GET /api/disputes` lists open disputes from the seller's PayPal account (Disputes API v1), plus three sample cases.
2. **Investigate.** `POST /api/agent` runs a Claude agent (`claude-opus-5-5`, adaptive thinking) one turn per request. Its tools:
   - `get_dispute`: PayPal Disputes API, `GET /v1/customer/disputes/{id}`
   - `get_order_details`: PayPal Payments v2 capture, then Orders v2 checkout order (items, shipping address, Seller Protection status)
   - `get_merchant_records`: tracking, emails and policies the seller pastes in
   - `submit_case_brief`: a strict JSON brief: verdict (fight / refund / offer), confidence, cited facts, evidence mapped to PayPal evidence types, response note, buyer message, gaps
3. **Approve.** `POST /api/act` sends what the seller approved: `provide-evidence` (with tracking info), `accept-claim`, `make-offer`, or `send-message`. In the sandbox, `adjudicate` lets you play PayPal's reviewer to finish the demo.

### Safety choices

- **Human in the loop.** The agent can only read. Every write to PayPal needs a click plus a confirmation.
- **Tools are locked to the open case.** The agent can't read another dispute or transaction, even if a buyer's message tries to make it.
- **Buyer text is treated as evidence, not instructions** (stated in the system prompt and enforced by the tool locks).
- **Signed conversation.** The browser carries the agent's conversation between turns, signed with an HMAC, so it can't be altered to misuse the AI key.
- **Honest advice.** The agent is told to recommend a refund when the buyer is probably right. Sample case 2 shows this.
- **Optional access code** (`ACCESS_CODE`) keeps strangers from using your deployment.
- Secrets stay in Vercel environment variables; the browser only talks to this site (strict CSP).

## Deploy (GitHub website + Vercel, no Git needed)

1. Create a new **public** GitHub repository, for example `casefile`.
2. Click **Add file → Upload files** and drag in everything in this folder **except** `node_modules` (there isn't one) and any `.env` file. Keep the folders (`api`, `api/_lib`, `fonts`) intact. Commit.
3. In Vercel: **Add New → Project → Import** the repo. Framework preset: **Other**. Leave build settings empty.
4. Under **Settings → Environment Variables**, add:

| Name | Value | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | Your key from console.anthropic.com | Yes |
| `PAYPAL_CLIENT_ID` | Sandbox app Client ID | For real disputes |
| `PAYPAL_CLIENT_SECRET` | Sandbox app Secret | For real disputes |
| `PAYPAL_ENV` | `sandbox` (default) or `live` | No |
| `ACCESS_CODE` | Any password you choose | Recommended |

5. Redeploy (Deployments → ⋯ → Redeploy) so the variables take effect.

Without PayPal keys the app still runs the three sample cases with the real AI agent.

## Getting a real sandbox dispute

1. developer.paypal.com → **Apps & Credentials** → Sandbox → **Create App** (Merchant). Copy the Client ID and Secret into Vercel.
2. **Testing Tools → Sandbox Accounts**: note the Personal (buyer) account email and password.
3. Open the demo store at `/shop.html` (linked from the Casefile inbox). Add items and pay with the PayPal button, logging in as the sandbox buyer. The server creates and captures the order with Orders v2; prices come from the server, never the browser.
4. On the receipt, add a carrier and tracking number. This calls the Orders v2 `track` endpoint, so PayPal itself stores the proof of shipment.
5. As the buyer, log in at sandbox.paypal.com, open **Resolution Center** and report a problem with that payment (for example "item not received").
6. Refresh Casefile: the dispute appears under "Your PayPal sandbox disputes" (it can take a minute or two). Paste any extra records, investigate, approve.
7. After submitting evidence, use **Simulate decision** to close the case like PayPal would.

The demo store refuses to run unless `PAYPAL_ENV` is `sandbox`, so it can never take real money. It isn't behind `ACCESS_CODE`, so judges can place sandbox orders themselves.

## Project layout

```
index.html, styles.css, app.js   the web app (no build step)
shop.html, shop.js               sandbox demo store (PayPal JS SDK buttons)
api/disputes.js                  inbox and case details
api/agent.js                     one turn of the Claude agent
api/act.js                       approved actions sent to PayPal
api/checkout.js                  demo store: create, capture, add tracking (Orders v2)
api/_lib/paypal.js               PayPal REST client (OAuth, Disputes v1, Payments v2, Orders v2)
api/_lib/catalog.js              demo store products and server-side pricing
api/_lib/demo-data.js            three sample cases in PayPal's own field format
api/_lib/http.js                 shared helpers, access code check
fonts/                           self-hosted fonts (SIL Open Font License)
```

## Fonts

Instrument Sans, Instrument Serif and JetBrains Mono, self-hosted, under the SIL Open Font License (see `fonts/OFL-*.txt`).
