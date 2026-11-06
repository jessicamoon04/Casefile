"use strict";

const $ = (id) => document.getElementById(id);

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of [].concat(children || [])) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const usd = (v) => "$" + Number(v).toFixed(2);

let catalog = [];
let shipping = "0.00";
const cart = {}; // sku -> qty
let paid = null;

function say(target, text, ok) {
  $(target).replaceChildren(text ? el("div", { class: "result " + (ok ? "ok" : "bad"), text }) : "");
}

async function post(body) {
  const r = await fetch("/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data.error || "Request failed") + (data.debug_id ? " (PayPal debug ID " + data.debug_id + ")" : ""));
  return data;
}

function cartList() {
  return Object.entries(cart).filter(([, q]) => q > 0).map(([sku, qty]) => ({ sku, qty }));
}

function renderCart() {
  const lines = cartList();
  let sum = 0;
  $("cart-lines").replaceChildren(...(lines.length ? lines.map(({ sku, qty }) => {
    const p = catalog.find((x) => x.sku === sku);
    sum += Number(p.price) * qty;
    return el("li", null, [
      el("span", { text: qty + " × " + p.name }),
      el("span", { class: "mono", text: usd(Number(p.price) * qty) })
    ]);
  }) : [el("li", { class: "empty", text: "Add something to pay with PayPal." })]));
  $("ship").textContent = lines.length ? usd(shipping) : "";
  $("total").textContent = lines.length ? usd(sum + Number(shipping)) : "";
  $("paypal-buttons").hidden = !lines.length || Boolean(paid);
}

function renderProducts() {
  $("products").replaceChildren(...catalog.map((p) => el("li", { class: "product" }, [
    el("div", null, [el("div", { class: "product-name", text: p.name }), el("div", { class: "mono", text: usd(p.price) })]),
    el("div", { class: "qty" }, [
      el("button", { type: "button", class: "btn btn-secondary", "aria-label": "Remove one " + p.name, onclick: () => { cart[p.sku] = Math.max(0, (cart[p.sku] || 0) - 1); renderProducts(); renderCart(); } }, "−"),
      el("span", { class: "mono", "aria-live": "polite", text: String(cart[p.sku] || 0) }),
      el("button", { type: "button", class: "btn btn-secondary", "aria-label": "Add one " + p.name, onclick: () => { cart[p.sku] = Math.min(10, (cart[p.sku] || 0) + 1); renderProducts(); renderCart(); } }, "+")
    ])
  ])));
}

function showPaid(result) {
  paid = result;
  $("paypal-buttons").hidden = true;
  const a = result.address || {};
  const address = [a.address_line_1, a.address_line_2, a.admin_area_2, a.admin_area_1, a.postal_code, a.country_code].filter(Boolean).join(", ");
  const rows = [
    ["Status", result.capture_status || result.status],
    ["Amount", result.amount ? result.amount.value + " " + result.amount.currency_code : ""],
    ["Order ID", result.order_id],
    ["Transaction ID", result.capture_id],
    ["Ship to", [result.ship_to, address].filter(Boolean).join(", ")]
  ];
  $("receipt").replaceChildren(...rows.flatMap(([k, v]) => [el("dt", { text: k }), el("dd", { class: k.endsWith("ID") ? "mono" : null, text: v || "Not provided" })]));
  $("after").hidden = false;
  $("after").scrollIntoView({ behavior: "smooth", block: "start" });
}

function loadPayPal(clientId) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://www.paypal.com/sdk/js?client-id=" + encodeURIComponent(clientId) +
      "&currency=USD&intent=capture&disable-funding=card,credit,paylater,venmo";
    s.onload = resolve;
    s.onerror = () => reject(new Error("PayPal's checkout script didn't load. Check your connection or ad blocker."));
    document.head.append(s);
  });
}

async function start() {
  let config;
  try {
    const r = await fetch("/api/checkout", { headers: { Accept: "application/json" } });
    config = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(config.error || "The store is unavailable.");
  } catch (e) {
    say("shop-message", e.message, false);
    return;
  }
  catalog = config.catalog;
  shipping = config.shipping;
  cart[catalog[0].sku] = 1;
  renderProducts();
  renderCart();

  try {
    await loadPayPal(config.clientId);
  } catch (e) {
    say("shop-message", e.message, false);
    return;
  }

  window.paypal.Buttons({
    style: { layout: "vertical", shape: "rect", label: "pay" },
    createOrder: async () => {
      say("shop-message", "");
      const r = await post({ action: "create", cart: cartList() });
      return r.id;
    },
    onApprove: async (data) => {
      try {
        const r = await post({ action: "capture", order_id: data.orderID });
        if (r.capture_status !== "COMPLETED") say("shop-message", "PayPal returned status " + (r.capture_status || r.status) + ".", false);
        showPaid(r);
      } catch (e) {
        say("shop-message", e.message, false);
      }
    },
    onError: (err) => {
      say("shop-message", "Checkout failed: " + (err && err.message ? err.message : "unknown error"), false);
    }
  }).render("#paypal-buttons");
}

$("track-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!paid) return;
  const btn = event.target.querySelector("button");
  btn.disabled = true;
  try {
    await post({
      action: "track",
      order_id: paid.order_id,
      capture_id: paid.capture_id,
      carrier: $("carrier").value,
      tracking_number: $("tracking").value
    });
    say("track-message", "Tracking added to the PayPal order.", true);
  } catch (e) {
    say("track-message", e.message, false);
  } finally {
    btn.disabled = false;
  }
});

start();
