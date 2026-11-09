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
        seller_response_due_date: iso(6),
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
            address: { address_line_1: "418 Larkin Ave", admin_area_2: "Columbus", admin_area_1: "OH", postal_code: "43215", country_code: "US" },
            trackers: [{ id: "DEMOCAP-7Y21-9400111899224471038652", status: "SHIPPED" }]
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
        seller_response_due_date: iso(11),
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
            address: { address_line_1: "77 Pierce St, Apt 3", admin_area_2: "Providence", admin_area_1: "RI", postal_code: "02906", country_code: "US" },
            trackers: [{ id: "DEMOCAP-3QP8-1Z4F89X20366182207", status: "SHIPPED" }]
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
        seller_response_due_date: iso(2),
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
            address: { address_line_1: "2210 Maple Grove Rd", admin_area_2: "Houston", admin_area_1: "TX", postal_code: "77084", country_code: "US" },
            trackers: [{ id: "DEMOCAP-8RT4-778122904416", status: "SHIPPED" }]
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
    },

    "DEMO-INR-1180": {
      dispute: {
        dispute_id: "DEMO-INR-1180",
        create_time: iso(-9),
        update_time: iso(-9),
        reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
        status: "WAITING_FOR_SELLER_RESPONSE",
        dispute_state: "REQUIRED_ACTION",
        dispute_amount: money("64.00"),
        dispute_life_cycle_stage: "INQUIRY",
        dispute_channel: "INTERNAL",
        seller_response_due_date: iso(0.62),
        disputed_transactions: [{
          seller_transaction_id: "DEMOCAP-4HN2",
          create_time: iso(-16),
          transaction_status: "COMPLETED",
          gross_amount: money("64.00"),
          buyer: { name: "Priya Raman" },
          seller: { name: "Ember & Wick Candle Co." }
        }],
        messages: [{
          posted_by: "BUYER",
          time_posted: iso(-9),
          content: "Tracking says delivered but there was nothing at my door. Can you check with the courier?"
        }]
      },
      order: {
        id: "DEMOORDER-7QT",
        status: "COMPLETED",
        create_time: iso(-16),
        purchase_units: [{
          amount: money("64.00"),
          items: [
            { name: "Fig & Tobacco travel candle", quantity: "2", unit_amount: money("22.00") },
            { name: "Brass wick trimmer", quantity: "1", unit_amount: money("12.50") }
          ],
          shipping: {
            name: { full_name: "Priya Raman" },
            address: { address_line_1: "1290 Alder St, Unit 4", admin_area_2: "Portland", admin_area_1: "OR", postal_code: "97205", country_code: "US" },
            trackers: [{ id: "DEMOCAP-4HN2-9400111899227730155108", status: "SHIPPED" }]
          }
        }]
      },
      records: [
        "SHIPPING (USPS Ground Advantage, tracking 9400 1118 9922 7730 1551 08):",
        "- Delivered, in/at mailbox, Portland OR 97205, 11 days ago. No signature taken.",
        "- Ship-to matches the PayPal shipping address, including Unit 4.",
        "",
        "EMAIL FROM BUYER, 9 days ago: \"Tracking says delivered but nothing came. My building has had parcels go missing before.\"",
        "",
        "We have not replied yet.",
        "",
        "STORE POLICY: we help file carrier claims for parcels marked delivered."
      ].join("\n")
    },

    "DEMO-SNAD-2291": {
      dispute: {
        dispute_id: "DEMO-SNAD-2291",
        create_time: iso(-12),
        update_time: iso(-2),
        reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
        status: "UNDER_REVIEW",
        dispute_state: "UNDER_PAYPAL_REVIEW",
        dispute_amount: money("38.00"),
        dispute_life_cycle_stage: "CHARGEBACK",
        dispute_channel: "INTERNAL",
        seller_response_due_date: iso(-2),
        disputed_transactions: [{
          seller_transaction_id: "DEMOCAP-9KD1",
          create_time: iso(-20),
          transaction_status: "COMPLETED",
          gross_amount: money("38.00"),
          buyer: { name: "Tom Becker" },
          seller: { name: "Ember & Wick Candle Co." }
        }],
        messages: [{
          posted_by: "BUYER",
          time_posted: iso(-12),
          content: "The scent is much weaker than described. I want my money back."
        }]
      },
      order: {
        id: "DEMOORDER-3VB",
        status: "COMPLETED",
        create_time: iso(-20),
        purchase_units: [{
          amount: money("38.00"),
          items: [{ name: "Cedar & Smoke candle, 8oz", quantity: "2", unit_amount: money("19.00") }],
          shipping: {
            name: { full_name: "Tom Becker" },
            address: { address_line_1: "55 Harbor Rd", admin_area_2: "Salem", admin_area_1: "MA", postal_code: "01970", country_code: "US" }
          }
        }]
      },
      records: [
        "The listing describes the scent as \"soft, woody\". Same batch sold 40 units with no complaints.",
        "We submitted our response 2 days ago. The buyer has used both candles according to their own photo."
      ].join("\n")
    },

    "DEMO-UNAUTH-3350": {
      dispute: {
        dispute_id: "DEMO-UNAUTH-3350",
        create_time: iso(-6),
        update_time: iso(-1),
        reason: "UNAUTHORISED",
        status: "WAITING_FOR_BUYER_RESPONSE",
        dispute_state: "INQUIRY_BY_PAYPAL",
        dispute_amount: money("120.00"),
        dispute_life_cycle_stage: "INQUIRY",
        dispute_channel: "INTERNAL",
        seller_response_due_date: iso(8),
        disputed_transactions: [{
          seller_transaction_id: "DEMOCAP-2PW7",
          create_time: iso(-14),
          transaction_status: "COMPLETED",
          gross_amount: money("120.00"),
          buyer: { name: "Lena Fischer" },
          seller: { name: "Ember & Wick Candle Co." }
        }],
        messages: [
          { posted_by: "BUYER", time_posted: iso(-6), content: "I don't recognise this payment." },
          { posted_by: "SELLER", time_posted: iso(-1), content: "Hi Lena, this was a gift order shipped to Anna Fischer at your saved address. Could this be a family member's purchase?" }
        ]
      },
      order: {
        id: "DEMOORDER-8XJ",
        status: "COMPLETED",
        create_time: iso(-14),
        purchase_units: [{
          amount: money("120.00"),
          items: [{ name: "Gift set: three seasonal candles", quantity: "1", unit_amount: money("120.00") }],
          shipping: {
            name: { full_name: "Anna Fischer" },
            address: { address_line_1: "8 Linden Way", admin_area_2: "Madison", admin_area_1: "WI", postal_code: "53703", country_code: "US" }
          }
        }]
      },
      records: [
        "The order shipped to Anna Fischer at the address saved on the buyer's PayPal account.",
        "We messaged the buyer yesterday asking whether a family member placed it. Waiting for their reply."
      ].join("\n")
    }
  };
}

// Closed sample cases from the past year, so charts, win rate and resolution time have history to show.
// [id suffix, opened days ago, resolved days ago, reason, amount, buyer, PayPal outcome code, item]
const NR = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED";
const NAD = "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED";
const UA = "UNAUTHORISED";
const DUP = "DUPLICATE_TRANSACTION";
const HISTORY = [
  ["H01", 352, 330, NR, "72.00", "Grace Okonkwo", "RESOLVED_SELLER_FAVOUR", "Cedar & Smoke candle, 16oz"],
  ["H02", 318, 301, NAD, "98.00", "Luis Ortega", "ACCEPTED", "Grand glass vessel candle, 48oz"],
  ["H03", 290, 262, UA, "45.50", "Hannah Cole", "RESOLVED_SELLER_FAVOUR", "Fig & Tobacco travel candle"],
  ["H04", 251, 236, NR, "56.00", "Ibrahim Musa", "RESOLVED_BUYER_FAVOUR", "Cedar & Smoke candle, 16oz"],
  ["H05", 214, 199, NR, "134.00", "Sofia Rossi", "RESOLVED_SELLER_FAVOUR", "Gift set: three seasonal candles"],
  ["H06", 180, 171, NAD, "22.00", "Ben Carter", "ACCEPTED", "Fig & Tobacco travel candle"],
  ["H07", 151, 128, UA, "89.00", "Mei Lin", "RESOLVED_SELLER_FAVOUR", "Seasonal candle subscription, 1 month"],
  ["H08", 122, 104, NR, "64.50", "Daniel Price", "RESOLVED_SELLER_FAVOUR", "Cedar & Smoke candle, 16oz"],
  ["H09", 96, 85, NAD, "142.00", "Amara Nwosu", "RESOLVED_BUYER_FAVOUR", "Grand glass vessel candle, 48oz"],
  ["H10", 74, 52, NR, "38.00", "Chloe Martin", "RESOLVED_SELLER_FAVOUR", "Cedar & Smoke candle, 8oz"],
  ["H11", 58, 46, DUP, "34.00", "Oliver Grant", "ACCEPTED", "Cedar & Smoke candle, 16oz"],
  ["H12", 41, 24, UA, "112.00", "Fatima Bello", "RESOLVED_SELLER_FAVOUR", "Gift set: three seasonal candles"],
  ["H13", 33, 19, NR, "48.00", "Ethan Brooks", "RESOLVED_SELLER_FAVOUR", "Fig & Tobacco travel candle"],
  ["H14", 24, 9, NAD, "76.00", "Zara Ahmed", "ACCEPTED", "Grand glass vessel candle, 48oz"],
  ["H15", 16, 5, NR, "54.00", "Noah Fischer", "RESOLVED_SELLER_FAVOUR", "Cedar & Smoke candle, 16oz"],
  ["H16", 12, 3, UA, "29.00", "Ava Thompson", "RESOLVED_BUYER_FAVOUR", "Seasonal candle subscription, 1 month"]
];
const HISTORY_COMPLAINT = {
  [NR]: "My order never arrived.",
  [NAD]: "What I received isn't what was described.",
  [UA]: "I didn't authorize this payment.",
  [DUP]: "I was charged twice for the same order."
};

function historyCase(row) {
  const [suffix, opened, resolved, reason, amount, buyer, outcome, item] = row;
  const id = "DEMO-" + suffix;
  const tx = "DEMOCAP-" + suffix;
  return {
    dispute: {
      dispute_id: id,
      create_time: iso(-opened),
      update_time: iso(-resolved),
      reason,
      status: "RESOLVED",
      dispute_state: "RESOLVED",
      dispute_amount: money(amount),
      dispute_outcome: { outcome_code: outcome },
      dispute_life_cycle_stage: reason === UA ? "CHARGEBACK" : "INQUIRY",
      dispute_channel: "INTERNAL",
      seller_response_due_date: iso(-opened + 10),
      disputed_transactions: [{
        seller_transaction_id: tx,
        create_time: iso(-opened - 7),
        transaction_status: "COMPLETED",
        gross_amount: money(amount),
        buyer: { name: buyer },
        seller: { name: "Ember & Wick Candle Co." }
      }],
      messages: [{ posted_by: "BUYER", time_posted: iso(-opened), content: HISTORY_COMPLAINT[reason] }]
    },
    order: {
      id: "DEMOORDER-" + suffix,
      status: "COMPLETED",
      create_time: iso(-opened - 7),
      purchase_units: [{
        amount: money(amount),
        items: [{ name: item, quantity: "1", unit_amount: money(amount) }],
        shipping: { name: { full_name: buyer } }
      }]
    },
    records: "Closed sample case. Detailed records were not kept."
  };
}

function isDemo(id) {
  return /^DEMO-/.test(String(id));
}

// Demo documents for the open sample cases: the same facts as their records, split into the
// separate files a seller would actually have. Always labelled as sample documents.
function demoDocs(id) {
  const t = (n, name, category, daysAgo, text) => ({ id: id + "-D" + n, name, category, date: iso(-daysAgo), kind: "text", text, demo: true });
  const docs = {
    "DEMO-INR-1042": [
      t(1, "USPS tracking history", "TRACKING", 15, "USPS Ground Advantage, tracking 9400 1118 9922 4471 0386 52\n- Label created and shipped from Asheville NC, 19 days ago.\n- Delivered, front door/porch, Columbus OH 43215, 15 days ago. Delivery photo available in the seller's USPS account.\n- Ship-to on label: Dana Whitfield, 418 Larkin Ave, Columbus OH 43215."),
      t(2, "Email thread with Dana Whitfield", "CONVERSATION", 14, "From the buyer, 14 days ago:\n\"Hi! Love the smell of the cedar one. Do you sell the trimmer in black too? Would buy another set as a gift.\"\n\nOur reply, 14 days ago:\n\"Thanks Dana! Black trimmers are back in stock next month, we'll email you.\""),
      t(3, "Shipping policy (checkout page)", "POLICY", 120, "Orders ship in 2 business days. We are not responsible for packages marked delivered by the carrier, but we help file carrier claims.")
    ],
    "DEMO-SNAD-2210": [
      t(1, "UPS tracking summary", "TRACKING", 4, "UPS Ground, tracking 1Z 4F8 9X2 03 6618 2207: delivered 4 days ago, left at door."),
      t(2, "Buyer email with photos", "CONVERSATION", 3, "From the buyer, 3 days ago (one day after delivery), with 2 photos:\n\"The big candle is cracked and wax got everywhere. Photos attached. The small ones are fine. Can you fix this?\"\nPhotos show a vertical crack in the 48oz glass vessel and a wax stain on the inside of the box.\n\nWe did not reply yet."),
      t(3, "Packing notes", "PACKING", 6, "Packed by Tolu. Single wall box, 1 layer of bubble wrap. Our standard for 48oz vessels is a double wall box."),
      t(4, "Breakage policy", "POLICY", 120, "Items broken in transit are refunded or replaced if reported within 7 days with a photo.")
    ],
    "DEMO-UNAUTH-3307": [
      t(1, "Customer order history", "CUSTOMER_HISTORY", 0, "Same email and shipping address as this order:\n- 4 earlier paid orders over the last 7 months, none disputed.\n- Customer account created 7 months ago. Logged in from Houston TX on the day of this order, same device as the earlier orders.\n- No report of a stolen card or account received."),
      t(2, "FedEx delivery record", "TRACKING", 26, "FedEx Home Delivery, tracking 7781 2290 4416: delivered 26 days ago, signed by \"J OKAFOR\"."),
      t(3, "Customer email", "CONVERSATION", 20, "From the customer, 20 days ago: \"Got the October box, the pumpkin one is amazing.\"")
    ],
    "DEMO-INR-1180": [
      t(1, "USPS tracking history", "TRACKING", 11, "USPS Ground Advantage, tracking 9400 1118 9922 7730 1551 08\n- Delivered, in/at mailbox, Portland OR 97205, 11 days ago. No signature taken.\n- Ship-to matches the PayPal shipping address, including Unit 4."),
      t(2, "Email from Priya Raman", "CONVERSATION", 9, "\"Tracking says delivered but nothing came. My building has had parcels go missing before.\"\n\nWe have not replied yet."),
      t(3, "Carrier claim policy", "POLICY", 120, "We help file carrier claims for parcels marked delivered.")
    ],
    "DEMO-SNAD-2291": [
      t(1, "Product listing description", "OTHER", 90, "Cedar & Smoke candle, 8oz. Scent described as \"soft, woody\". Same batch sold 40 units with no complaints."),
      t(2, "Buyer photo note", "CONVERSATION", 10, "The buyer's own photo shows both candles burned down by about a third.")
    ],
    "DEMO-UNAUTH-3350": [
      t(1, "Gift order note", "OTHER", 14, "The order shipped to Anna Fischer at the address saved on the buyer's PayPal account.")
    ]
  };
  return docs[id] || [];
}

function allCases() {
  const map = cases();
  for (const row of HISTORY) {
    const c = historyCase(row);
    map[c.dispute.dispute_id] = c;
  }
  return map;
}

function getCase(id) {
  return allCases()[id] || null;
}

// The same summary shape api/disputes.js builds for real PayPal disputes.
function summarize(c) {
  const d = c.dispute;
  const tx = d.disputed_transactions[0];
  return {
    dispute_id: d.dispute_id,
    create_time: d.create_time,
    update_time: d.update_time,
    reason: d.reason,
    status: d.status,
    dispute_amount: d.dispute_amount,
    seller_response_due_date: d.seller_response_due_date,
    dispute_life_cycle_stage: d.dispute_life_cycle_stage,
    outcome: d.dispute_outcome ? d.dispute_outcome.outcome_code : null,
    resolved_time: d.status === "RESOLVED" ? d.update_time : null,
    buyer_name: tx.buyer.name,
    transaction_id: tx.seller_transaction_id,
    order_id: c.order ? c.order.id : null,
    sample: true
  };
}

function listSummaries() {
  return Object.values(allCases()).map(summarize);
}

module.exports = { isDemo, getCase, listSummaries, demoDocs };
