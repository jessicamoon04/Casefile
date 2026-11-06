// Demo store catalog. Prices live on the server so the browser can't change what PayPal charges.
const CATALOG = {
  "CEDAR-16": { name: "Cedar & Smoke candle, 16oz", price: "34.00" },
  "FIG-TRAVEL": { name: "Fig & Tobacco travel candle", price: "22.00" },
  "GRAND-48": { name: "Grand glass vessel candle, 48oz", price: "98.00" },
  "TRIM-BRASS": { name: "Brass wick trimmer", price: "12.50" }
};
const SHIPPING = "6.00";

function cents(v) {
  return Math.round(Number(v) * 100);
}
function dollars(c) {
  return (c / 100).toFixed(2);
}

// Returns { items, itemTotal, shipping, total } or null if the cart is invalid.
function priceCart(cart) {
  if (!Array.isArray(cart) || !cart.length || cart.length > 10) return null;
  const items = [];
  let itemCents = 0;
  for (const line of cart) {
    const product = CATALOG[line && line.sku];
    const qty = Number(line && line.qty);
    if (!product || !Number.isInteger(qty) || qty < 1 || qty > 10) return null;
    itemCents += cents(product.price) * qty;
    items.push({
      name: product.name,
      sku: line.sku,
      quantity: String(qty),
      unit_amount: { currency_code: "USD", value: product.price },
      category: "PHYSICAL_GOODS"
    });
  }
  const shipCents = cents(SHIPPING);
  return {
    items,
    itemTotal: dollars(itemCents),
    shipping: SHIPPING,
    total: dollars(itemCents + shipCents)
  };
}

module.exports = { CATALOG, SHIPPING, priceCart };
