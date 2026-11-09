// What each investigation stage examined, retrieved and could not find.
// Statuses are decided here from the data actually available, never by the AI,
// so the timeline can't claim something was retrieved when it wasn't.

const STAGES = ["dispute", "order", "shipping", "conversations", "policies", "documents"];

const CATEGORY_LABELS = {
  TRACKING: "Tracking", PROOF_OF_DELIVERY: "Proof of delivery", CONVERSATION: "Conversation",
  POLICY: "Store policy", RECEIPT: "Receipt or invoice", PHOTO: "Photo", PACKING: "Packing record",
  CUSTOMER_HISTORY: "Customer history", OTHER: "Other"
};
const REASON_LABELS = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Item not received",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Not as described",
  UNAUTHORISED: "Unauthorized payment",
  CREDIT_NOT_PROCESSED: "Refund not processed",
  DUPLICATE_TRANSACTION: "Duplicate charge",
  INCORRECT_AMOUNT: "Wrong amount",
  PAYMENT_BY_OTHER_MEANS: "Paid another way",
  CANCELED_RECURRING_BILLING: "Cancelled subscription",
  PROBLEM_WITH_REMITTANCE: "Payment problem",
  OTHER: "Other"
};

function amountText(m) {
  return m && m.value ? m.value + " " + (m.currency_code || "") : "not listed";
}
function day(iso) {
  return iso ? String(iso).slice(0, 10) : "not listed";
}
function docLabel(d) {
  return "[" + d.id + "] " + d.name + " (" + (CATEGORY_LABELS[d.category] || "Other") + ", " +
    (d.date ? "dated " + day(d.date) : "undated") + ", " + (d.demo ? "sample document" : "uploaded by the seller") + ")";
}
// Text documents are given to the agent in the stage that matches their category.
// Images and PDFs are attached at the start of the conversation and only referenced here.
function docBody(d) {
  if (d.kind === "text" && d.text) return docLabel(d) + "\n" + d.text;
  return docLabel(d) + "\n(" + (d.kind === "image" ? "Image" : "PDF") + " attached at the start of this investigation.)";
}
function byCategory(docs, cats) {
  return (docs || []).filter((d) => cats.includes(d.category));
}

function stageDispute(dispute) {
  const msgs = dispute.messages || [];
  const tx = (dispute.disputed_transactions || [])[0] || {};
  return {
    key: "dispute",
    status: "COMPLETED",
    examined: "PayPal's dispute record",
    retrieved: [
      "Reason: " + (REASON_LABELS[dispute.reason] || dispute.reason || "not listed"),
      "Amount disputed: " + amountText(dispute.dispute_amount),
      "Stage: " + ({ INQUIRY: "Inquiry", CHARGEBACK: "Chargeback", PRE_ARBITRATION: "Pre-arbitration", ARBITRATION: "Arbitration" }[dispute.dispute_life_cycle_stage] || "not listed"),
      "Response due: " + day(dispute.seller_response_due_date),
      msgs.length + " message" + (msgs.length === 1 ? "" : "s") + " in the dispute",
      "Disputed payment: " + (tx.seller_transaction_id || "not listed")
    ],
    evidence: [{ label: "PayPal dispute record", basis: "VERIFIED_SOURCE" }],
    missing: []
  };
}

function stageOrder(result) {
  if (!result || result.error) {
    return {
      key: "order", status: "UNABLE", examined: "The PayPal payment and checkout order",
      retrieved: [],
      evidence: [],
      missing: ["PayPal couldn't return the order" + (result && result.error ? ": " + result.error : "") + ". Items, shipping address and stored tracking couldn't be checked."]
    };
  }
  const unit = result.order && Array.isArray(result.order.purchase_units) ? result.order.purchase_units[0] || {} : {};
  const ship = unit.shipping || {};
  const a = ship.address || {};
  const items = (unit.items || []).map((i) => (i.quantity || "1") + " x " + i.name);
  const trackers = (ship.trackers || []).length;
  const retrieved = [];
  if (!result.order) retrieved.push("Payment found, but no checkout order is linked to it");
  if (items.length) retrieved.push("Items: " + items.join("; "));
  if (a.address_line_1) retrieved.push("Ship-to address: " + [a.address_line_1, a.admin_area_2, a.admin_area_1, a.postal_code].filter(Boolean).join(", "));
  if (result.order) retrieved.push(trackers ? trackers + " tracking number" + (trackers === 1 ? "" : "s") + " stored on the order" : "No tracking stored on the order");
  const sp = result.capture && result.capture.seller_protection;
  if (sp && sp.status) retrieved.push("Seller Protection: " + sp.status.toLowerCase().replace(/_/g, " "));
  const missing = [];
  if (!result.order) missing.push("No checkout order, so the items and shipping address PayPal holds can't be checked.");
  else if (!a.address_line_1) missing.push("The order has no shipping address.");
  return {
    key: "order", status: result.order ? "COMPLETED" : "UNABLE", examined: "The PayPal payment and checkout order",
    retrieved,
    evidence: result.order ? [{ label: "PayPal order record", basis: "VERIFIED_SOURCE" }] : [],
    missing
  };
}

function trackingNumbers(order) {
  const unit = order && Array.isArray(order.purchase_units) ? order.purchase_units[0] || {} : {};
  return ((unit.shipping && unit.shipping.trackers) || []).map((t) => String(t.id || "").split("-").slice(-1)[0]).filter(Boolean);
}

function stageShipping(order, docs, records) {
  const onOrder = trackingNumbers(order);
  const tdocs = byCategory(docs, ["TRACKING", "PROOF_OF_DELIVERY"]);
  const retrieved = [];
  const evidence = [];
  if (onOrder.length) {
    retrieved.push("Tracking on the PayPal order: " + onOrder.join(", "));
    evidence.push({ label: "Tracking stored on the PayPal order", basis: "VERIFIED_SOURCE" });
  }
  tdocs.forEach((d) => { retrieved.push(d.name); evidence.push({ label: d.name, basis: "SELLER_PROVIDED", document_id: d.id }); });
  if (records) { retrieved.push("Records you pasted (unsorted)"); evidence.push({ label: "Records you pasted", basis: "SELLER_PROVIDED" }); }
  const missing = ["Live carrier tracking isn't connected, so delivery wasn't confirmed with the carrier directly."];
  if (!onOrder.length && !tdocs.length) missing.push("No tracking record was provided" + (records ? " apart from what may be in your pasted records" : "") + ".");
  if (!byCategory(docs, ["PROOF_OF_DELIVERY"]).length) missing.push("No proof-of-delivery document (delivery photo or signature) has been added.");
  return {
    key: "shipping",
    status: onOrder.length || tdocs.length || records ? "COMPLETED" : "NEEDS_INPUT",
    examined: "Shipping and carrier tracking records",
    retrieved, evidence, missing
  };
}

function stageConversations(dispute, docs) {
  const msgs = dispute.messages || [];
  const cdocs = byCategory(docs, ["CONVERSATION"]);
  const retrieved = [];
  const evidence = [];
  if (msgs.length) {
    retrieved.push(msgs.length + " message" + (msgs.length === 1 ? "" : "s") + " in the PayPal dispute");
    evidence.push({ label: "Messages in the PayPal dispute", basis: "VERIFIED_SOURCE" });
  }
  cdocs.forEach((d) => { retrieved.push(d.name); evidence.push({ label: d.name, basis: "SELLER_PROVIDED", document_id: d.id }); });
  const missing = [];
  if (!cdocs.length) missing.push("No emails or chats with the buyer outside PayPal have been added.");
  return {
    key: "conversations",
    status: msgs.length || cdocs.length ? "COMPLETED" : "NEEDS_INPUT",
    examined: "Conversations with the buyer",
    retrieved, evidence, missing
  };
}

function stagePolicies(docs) {
  const pdocs = byCategory(docs, ["POLICY"]);
  return {
    key: "policies",
    status: pdocs.length ? "COMPLETED" : "NEEDS_INPUT",
    examined: "Store refund and shipping policies",
    retrieved: pdocs.map((d) => d.name),
    evidence: pdocs.map((d) => ({ label: d.name, basis: "SELLER_PROVIDED", document_id: d.id })),
    missing: pdocs.length ? [] : ["No store policy has been added, so the buyer's claim can't be checked against what you promised."]
  };
}

function stageDocuments(docs) {
  const all = docs || [];
  return {
    key: "documents",
    status: all.length ? "COMPLETED" : "NEEDS_INPUT",
    examined: "Uploaded documents and supporting evidence",
    retrieved: all.map((d) => d.name + " (" + (CATEGORY_LABELS[d.category] || "Other") + ")"),
    evidence: all.map((d) => ({ label: d.name, basis: "SELLER_PROVIDED", document_id: d.id })),
    missing: all.length ? [] : ["No documents have been uploaded for this case."]
  };
}

// Text given to the agent for the shipping, conversation, policy and document stages.
function shippingText(order, docs, records) {
  const parts = [];
  const onOrder = trackingNumbers(order);
  parts.push("TRACKING STORED ON THE PAYPAL ORDER (verified source): " + (onOrder.length ? onOrder.join(", ") : "none"));
  parts.push("LIVE CARRIER LOOKUP: not connected. Do not claim the carrier confirmed anything beyond what the records below say.");
  const tdocs = byCategory(docs, ["TRACKING", "PROOF_OF_DELIVERY"]);
  parts.push("SELLER-PROVIDED TRACKING DOCUMENTS: " + (tdocs.length ? "\n" + tdocs.map(docBody).join("\n\n") : "none"));
  if (records) parts.push("RECORDS THE SELLER PASTED (seller-provided, unsorted; they may also contain messages and policies):\n<seller_records>\n" + records + "\n</seller_records>");
  return parts.join("\n\n");
}
function conversationsText(dispute, docs) {
  const msgs = (dispute.messages || []).map((m) => "- " + (m.posted_by || "UNKNOWN") + " on " + day(m.time_posted) + ": " + m.content);
  const cdocs = byCategory(docs, ["CONVERSATION"]);
  return "MESSAGES IN THE PAYPAL DISPUTE (verified source):\n" + (msgs.length ? msgs.join("\n") : "none") +
    "\n\nSELLER-PROVIDED CONVERSATIONS: " + (cdocs.length ? "\n" + cdocs.map(docBody).join("\n\n") : "none") +
    "\n\nIf the seller pasted records, they were given in the shipping step and may include emails.";
}
function policiesText(docs) {
  const pdocs = byCategory(docs, ["POLICY"]);
  return "SELLER-PROVIDED POLICIES: " + (pdocs.length ? "\n" + pdocs.map(docBody).join("\n\n") : "none") +
    "\n\nIf the seller pasted records, they were given in the shipping step and may include policies.";
}
function documentsText(docs) {
  const all = docs || [];
  if (!all.length) return "No documents have been uploaded.";
  return "ALL DOCUMENTS FOR THIS CASE (seller-provided unless marked as sample):\n" + all.map((d) => {
    if (["TRACKING", "PROOF_OF_DELIVERY", "CONVERSATION", "POLICY"].includes(d.category) && d.kind === "text") return docLabel(d) + " (content given in its stage)";
    return docBody(d);
  }).join("\n\n");
}

module.exports = {
  STAGES, CATEGORY_LABELS,
  stageDispute, stageOrder, stageShipping, stageConversations, stagePolicies, stageDocuments,
  shippingText, conversationsText, policiesText, documentsText
};
