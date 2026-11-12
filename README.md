# Casefile

**AI dispute defense for PayPal sellers.** Casefile investigates a PayPal dispute with Claude, checks every buyer claim against the evidence, recommends whether to fight, refund or offer, and drafts the response and evidence packet. The seller reviews and approves. Only then does anything go to PayPal.

Built for the PayPal AI Hackathon (Devpost). Runs entirely in the **PayPal sandbox**.

- **Live demo:** https://casefile-livid.vercel.app
- **License:** MIT (see `LICENSE`)

## How we use PayPal

All calls use the PayPal REST APIs in the **sandbox** (`api/_lib/paypal.js`).

| PayPal tool | What it does in Casefile |
|---|---|
| **OAuth 2.0** (client credentials) | Server-side access token from the sandbox app's Client ID and Secret, kept only in environment variables. |
| **Disputes API v1** | *List* and *show* disputes (reason, amount, status, deadline, buyer messages, transaction). *Provide evidence* sends the seller-approved response and evidence (multipart), using the evidence types PayPal accepts for that dispute reason. *Accept claim* (refund), *make offer* (partial refund), *send message*, *escalate* (inquiry to claim), and the sandbox-only *settle dispute* to simulate PayPal's ruling. |
| **Payments API v2** (captures) | Finds the payment behind a dispute and links it to its checkout order. |
| **Orders API v2** | Gives the AI the items, amounts, shipping address and tracking stored on the order. Powers the demo store: create, capture, and add tracking. |
| **PayPal JavaScript SDK** | Smart Payment Buttons in the demo store (`shop.html`), so anyone can pay with a sandbox buyer and open a real sandbox dispute. |
| **Sandbox accounts** | A business account (the seller) and a personal account (the buyer) for end-to-end tests. |

## How we use AI

**Anthropic Claude** (`claude-opus-5-5`) through the **Claude API**, using Anthropic's official JavaScript SDK (`@anthropic-ai/sdk`), with adaptive thinking (`api/agent.js`).

Claude runs as an investigation agent with eight strict tools, each locked to the case being investigated:

| Tool | Purpose |
|---|---|
| `get_dispute` | Stage 1: the PayPal dispute |
| `get_order_details` | Stage 2: the capture and checkout order |
| `get_shipping_records` | Stage 3: tracking and proof of delivery |
| `get_customer_conversations` | Stage 4: buyer messages and emails |
| `get_store_policies` | Stage 5: refund and shipping policies |
| `get_uploaded_documents` | Stage 6: receipts, photos and other documents (Claude reads images and PDFs) |
| `submit_findings` | Records each buyer claim as supported, contradicted or unable to verify, with sources, plus evidence strength and what's missing |
| `submit_case_brief` | The recommendation (fight / refund / offer), confidence, drafted response and evidence packet |

**Safety and honesty**

- **Human in the loop.** Claude can only read. Every action sent to PayPal needs the seller's review, a tick box and a confirmation showing the exact packet.
- **Code decides, not the model.** Each stage's status (completed, needs input, unable to check) is computed from the data actually retrieved, so the AI can't claim it checked something it didn't.
- **Buyer text is evidence, not instructions.** The system prompt says so, and the tool locks enforce it.
- **Signed conversation.** One agent turn runs per request. The browser carries the conversation between turns, signed with an HMAC, so it can't be altered.
- **Honest advice.** Casefile recommends a refund when the buyer is probably right.

## Other tools and technologies

- **Vercel**: static hosting plus Node.js serverless functions (`api/`).
- **Plain HTML, CSS and JavaScript**, with no framework and no build step. Browser `localStorage` and `IndexedDB` keep the seller's notes, investigations and uploads on their own device.
- **GitHub**: source hosting.
- **Fonts:** Instrument Sans, Instrument Serif and JetBrains Mono, self-hosted under the SIL Open Font License (`fonts/OFL-*.txt`).

No other sponsor integrations are used.

## Setup (GitHub + Vercel)

1. **Fork or upload this repo** to your GitHub account. Keep the folders `api`, `api/_lib` and `fonts` intact.
2. **Create a PayPal sandbox app:** developer.paypal.com → **Apps & Credentials** → **Sandbox** → **Create App** (Merchant). Copy the Client ID and Secret.
3. **Create sandbox accounts:** **Testing Tools → Sandbox Accounts**. Use a **US Business** account (seller) and a **US Personal** account (buyer).
4. **Get a Claude API key** from the Anthropic Console (console.anthropic.com).
5. **Deploy on Vercel:** **Add New → Project → Import** the repo. Framework preset: **Other**. Leave the build settings empty.
6. **Add environment variables** (Vercel → Settings → Environment Variables):

| Name | Value | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | Your Claude API key | Yes |
| `PAYPAL_CLIENT_ID` | Sandbox app Client ID | For real disputes |
| `PAYPAL_CLIENT_SECRET` | Sandbox app Secret | For real disputes |
| `PAYPAL_ENV` | `sandbox` (the default) | No |
| `ACCESS_CODE` | A password of your choice | Recommended |

7. **Redeploy** (Deployments → ⋯ → Redeploy) so the variables take effect.

Without PayPal keys, the app still runs the sample cases with the real AI agent. The demo store refuses to run unless the environment is the sandbox, so it can never take real money.

## Testing it

1. Open the site and click **Open Casefile**. Enter the access code if one is set.
2. **Sample cases:** switch the top bar to **Sample cases**, click **Investigate** on any case, then **Start investigation**. Explore the Contradictions, Evidence and Response tabs. Decisions on sample cases are simulated and never reach PayPal.
3. **A real sandbox dispute:**
   1. Open the demo store (`/shop.html`) and pay with the sandbox **Personal** buyer.
   2. On the receipt, add a carrier and tracking number. This calls Orders v2 *track*.
   3. Log in at sandbox.paypal.com as the buyer → **Resolution Center** → report a problem with that payment.
   4. Back in Casefile, choose **Your disputes**. Casefile checks PayPal every minute, and PayPal's sandbox can take a few minutes to make a new dispute available.
   5. Investigate, review, and submit the response. In **Sandbox tools**, *Escalate to a claim* and, once PayPal opens the case for a decision, *Simulate: you win*.

## Project layout

```
index.html, landing.css, landing.js   landing page and access-code check
app.html, styles.css                  the app shell
app.js, views.js, workspace.js        case pages, dashboard and views, investigation workspace
store.js, notify.js, main.js          browser storage, notifications, start-up
shop.html, shop.js                    sandbox demo store (PayPal JS SDK buttons)
privacy.html, terms.html, 404.html    legal pages
api/disputes.js                       dispute list and case details (Disputes v1)
api/agent.js                          one turn of the Claude agent
api/act.js                            approved actions sent to PayPal
api/checkout.js                       demo store: create, capture, add tracking (Orders v2)
api/access.js                         access-code check
api/_lib/paypal.js                    PayPal REST client (OAuth, Disputes v1, Payments v2, Orders v2)
api/_lib/stages.js                    investigation stage results, computed by code
api/_lib/demo-data.js                 sample cases in PayPal's own field format
api/_lib/catalog.js, http.js          demo store prices, shared helpers
fonts/                                self-hosted fonts (SIL Open Font License)
vercel.json                           routes and security headers
```
