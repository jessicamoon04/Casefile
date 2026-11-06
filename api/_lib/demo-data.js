// Sample cases for the demo. The store, buyers and tracking numbers are invented.
// Each dispute and order uses the same field names PayPal's Disputes v1 and Orders v2 APIs return,
// so the agent runs the exact same code path for sample cases and real sandbox cases.
// Dates are computed relative to "now" so the cases never look stale.

const DAY = 86400000;
function iso(daysFromNow) {
  return new Date(Date.now() + daysFromNow * DAY).toISOString().replace(/\.\d{3}Z$/, "Z");
}
function money(value) {
  return { currency_code: "USD", value };
}

function cases() {
  return {
    "DEMO-INR-1042": {
      dispute: {
        dispute_id: "DEMO-INR-1042",
        create_time: iso(-3),
        update_time: iso(-3),
        reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
        status: "WAITING_FOR_SELLER_RESPONSE",
        dispute_state: "REQUIRED_ACTION",
        dispute_amount: money("86.50"),
        dispute_life_cycle_stage: "CHARGEBACK",
        dispute_channel: "INTERNAL",
        seller_response_due_date: iso(7),
        disputed_transactions: [{
          seller_transaction_id: "DEMOCAP-7Y21",
          create_time: iso(-21),
          transaction_status: "COMPLETED",
          gross_amount: money("86.50"),
          buyer: { name: "Dana Whitfield" },
          seller: { name: "Ember & Wick Candle Co." }
        }],
        messages: [{
          posted_by: "BUYER",
          time_posted: iso(-3),
          content: "I never received my order. It has been almost three weeks. I want a full refund."
        }]
      },
      order: {
        id: "DEMOORDER-5KX",
        status: "COMPLETED",
        create_time: iso(-21),
        purchase_units: [{
          amount: money("86.50"),
          items: [
            { name: "Cedar & Smoke candle, 16oz", quantity: "2", unit_amount: money("34.00") },
            { name: "Brass wick trimmer", quantity: "1", unit_amount: money("12.50") }
          ],
          shipping: {
            name: { full_name: "Dana Whitfield" },
            address: { address_line_1: "418 Larkin Ave", admin_area_2: "Columbus", admin_area_1: "OH", postal_code: "43215", country_code: "US" }
          }
        }]
      },
      records: [
        "SHIPPING (USPS Ground Advantage, tracking 9400 1118 9922 4471 0386 52):",
        "- Label created and shipped from Asheville NC, 19 days ago.",
        "- Delivered, front door/porch, Columbus OH 43215, 15 days ago. Delivery photo available in USPS account.",
        "- Ship-to on label: Dana Whitfield, 418 Larkin Ave, Columbus OH 43215 (matches the PayPal shipping address).",
        "",
        "EMAIL FROM BUYER, 14 days ago:",
        "\"Hi! Love the smell of the cedar one. Do you sell the trimmer in black too? Would buy another set as a gift.\"",
        "",
        "OUR REPLY, 14 days ago:",
        "\"Thanks Dana! Black trimmers are back in stock next month, we'll email you.\"",
        "",
        "STORE POLICY (published on checkout page): Orders ship in 2 business days. We are not responsible for packages marked delivered by the carrier, but we help file carrier claims."
      ].join("\n")
    },

    "DEMO-SNAD-2210": {
      dispute: {
        dispute_id: "DEMO-SNAD-2210",
        create_time: iso(-2),
        update_time: iso(-2),
        reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
        status: "WAITING_FOR_SELLER_RESPONSE",
        dispute_state: "REQUIRED_ACTION",
        dispute_amount: money("142.00"),
        dispute_life_cycle_stage: "INQUIRY",
        dispute_channel: "INTERNAL",
        seller_response_due_date: iso(8),
        disputed_transactions: [{
          seller_transaction_id: "DEMOCAP-3QP8",
          create_time: iso(-9),
          transaction_status: "COMPLETED",
          gross_amount: money("142.00"),
          buyer: { name: "Marcus Oyelaran" },
          seller: { name: "Ember & Wick Candle Co." }
        }],
        messages: [{
          posted_by: "BUYER",
          time_posted: iso(-2),
          content: "The large glass vessel candle arrived with a crack down the side and wax leaked through the box. I sent photos to the seller. The two small candles are fine."
        }]
      },
      order: {
        id: "DEMOORDER-9LM",
        status: "COMPLETED",
        create_time: iso(-9),
        purchase_units: [{
          amount: money("142.00"),
          items: [
            { name: "Grand glass vessel candle, 48oz", quantity: "1", unit_amount: money("98.00") },
            { name: "Fig & Tobacco travel candle", quantity: "2", unit_amount: money("22.00") }
          ],
          shipping: {
            name: { full_name: "Marcus Oyelaran" },
            address: { address_line_1: "77 Pierce St, Apt 3", admin_area_2: "Providence", admin_area_1: "RI", postal_code: "02906", country_code: "US" }
          }
        }]
      },
      records: [
        "SHIPPING (UPS Ground, tracking 1Z 4F8 9X2 03 6618 2207): delivered 4 days ago, left at door.",
        "",
        "EMAIL FROM BUYER, 3 days ago (one day after delivery), with 2 photos:",
        "\"The big candle is cracked and wax got everywhere. Photos attached. The small ones are fine. Can you fix this?\"",
        "Photos show a vertical crack in the 48oz glass vessel and a wax stain on the inside of the box.",
        "",
        "We did not reply yet (missed the email during a busy week).",
        "",
        "PACKING NOTES: packed by Tolu, single wall box, 1 layer of bubble wrap. Our standard for 48oz vessels is double wall box.",
        "",
        "STORE POLICY (published): Items broken in transit are refunded or replaced if reported within 7 days with a photo."
      ].join("\n")
    },

    "DEMO-UNAUTH-3307": {
      dispute: {
        dispute_id: "DEMO-UNAUTH-3307",
        create_time: iso(-4),
        update_time: iso(-4),
        reason: "UNAUTHORISED",
        status: "WAITING_FOR_SELLER_RESPONSE",
        dispute_state: "REQUIRED_ACTION",
        dispute_amount: money("59.00"),
        dispute_life_cycle_stage: "CHARGEBACK",
        dispute_channel: "EXTERNAL",
        seller_response_due_date: iso(5),
        disputed_transactions: [{
          seller_transaction_id: "DEMOCAP-8RT4",
          create_time: iso(-30),
          transaction_status: "COMPLETED",
          gross_amount: money("59.00"),
          buyer: { name: "J. Okafor" },
          seller: { name: "Ember & Wick Candle Co." }
        }],
        messages: []
      },
      order: {
        id: "DEMOORDER-2WD",
        status: "COMPLETED",
        create_time: iso(-30),
        purchase_units: [{
          amount: money("59.00"),
          items: [{ name: "Seasonal candle subscription, 1 month", quantity: "1", unit_amount: money("59.00") }],
          shipping: {
            name: { full_name: "Jide Okafor" },
            address: { address_line_1: "2210 Maple Grove Rd", admin_area_2: "Houston", admin_area_1: "TX", postal_code: "77084", country_code: "US" }
          }
        }]
      },
      records: [
        "CUSTOMER HISTORY for this PayPal account (same email, same shipping address):",
        "- 4 earlier paid orders over the last 7 months, none disputed.",
        "- Customer account created 7 months ago. Logged in from Houston TX on the day of this order, same device as the earlier orders.",
        "",
        "SHIPPING (FedEx Home Delivery, tracking 7781 2290 4416): delivered 26 days ago, signed by \"J OKAFOR\".",
        "",
        "EMAIL FROM CUSTOMER, 20 days ago: \"Got the October box, the pumpkin one is amazing.\"",
        "",
        "No record of the customer reporting a stolen card or account to us."
      ].join("\n")
    }
  };
}

function isDemo(id) {
  return /^DEMO-/.test(String(id));
}

function getCase(id) {
  return cases()[id] || null;
}

function listSummaries() {
  return Object.values(cases()).map((c) => ({
    dispute_id: c.dispute.dispute_id,
    create_time: c.dispute.create_time,
    reason: c.dispute.reason,
    status: c.dispute.status,
    dispute_amount: c.dispute.dispute_amount,
    seller_response_due_date: c.dispute.seller_response_due_date,
    buyer_name: c.dispute.disputed_transactions[0].buyer.name,
    sample: true
  }));
}

module.exports = { isDemo, getCase, listSummaries };
