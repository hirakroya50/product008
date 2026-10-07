export const FREE_SHIPPING_THRESHOLD = 199;

export function shippingProgress(total: number) {
  return Math.max(0, Math.min(100, (total / FREE_SHIPPING_THRESHOLD) * 100));
}

export function ShippingProgress({ subtotal }: { subtotal: number }) {
  const remaining = Math.max(0, FREE_SHIPPING_THRESHOLD - subtotal);

  return (
    <section className="shipping-banner" aria-label="Free shipping progress">
      <p role="status">
        {remaining > 0
          ? `You're $${remaining.toFixed(2)} away from free shipping.`
          : "You unlocked free shipping!"}
      </p>
      <progress
        aria-label="Shipping progress"
        value={shippingProgress(subtotal)}
        max={100}
      />
    </section>
  );
}
