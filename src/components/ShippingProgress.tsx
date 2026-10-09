export const FREE_SHIPPING_THRESHOLD = 195;

export function shippingProgress(total: number) {
  const normalizedTotal = Number.isFinite(total) ? Math.max(0, total) : 0;
  return Math.max(
    0,
    Math.min(100, (normalizedTotal / FREE_SHIPPING_THRESHOLD) * 100),
  );
}

export function ShippingProgress({ subtotal }: { subtotal: number }) {
  const normalizedSubtotal = Number.isFinite(subtotal)
    ? Math.max(0, subtotal)
    : 0;
  const remaining = Math.max(0, FREE_SHIPPING_THRESHOLD - normalizedSubtotal);

  return (
    <section className="shipping-banner" aria-label="Free shipping progress">
      <p role="status">
        {remaining > 0
          ? `You're $${remaining.toFixed(2)} away from free shipping.`
          : "You unlocked free shipping!"}
      </p>
      <progress
        aria-label="Shipping progress"
        value={shippingProgress(normalizedSubtotal)}
        max={100}
      />
    </section>
  );
}
