import { X, Minus, Plus, ArrowRight, ShoppingBag } from "lucide-react";
import { useState } from "react";
import type { CartItem } from "../types/product";
import { cartKey, subtotal } from "../cart";
// SHIPPING_IMPORT
export function CartDrawer({
  items,
  onClose,
  onQuantity,
}: {
  items: CartItem[];
  onClose: () => void;
  onQuantity: (key: string, delta: number) => void;
}) {
  const [checkout, setCheckout] = useState(false);
  const total = subtotal(items);
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <section
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Shopping bag"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>
            Your bag <span>({items.reduce((s, i) => s + i.quantity, 0)})</span>
          </h2>
          <button aria-label="Close cart" onClick={onClose}>
            <X />
          </button>
        </header>
        {/* SHIPPING_BANNER */}
        <div className="cart-items">
          {items.length === 0 ? (
            <div className="empty-cart">
              <ShoppingBag size={40} />
              <h3>Your next favorite is waiting.</h3>
              <p>Add a little ThreadCraft to your day.</p>
            </div>
          ) : (
            items.map((item) => (
              <div className="cart-item" key={cartKey(item)}>
                <img src={item.product.image} alt={item.product.name} />
                <div>
                  <h3>{item.product.name}</h3>
                  <p>
                    Size {item.size} ·{" "}
                    <span style={{ color: item.color }}>●</span>
                  </p>
                  <div className="quantity">
                    <button
                      aria-label={`Decrease ${item.product.name}`}
                      onClick={() => onQuantity(cartKey(item), -1)}
                    >
                      <Minus size={14} />
                    </button>
                    <span>{item.quantity}</span>
                    <button
                      aria-label={`Increase ${item.product.name}`}
                      onClick={() => onQuantity(cartKey(item), 1)}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
                <strong>
                  ${(item.quantity * item.product.price).toFixed(2)}
                </strong>
              </div>
            ))
          )}
        </div>
        <footer>
          <div className="subtotal">
            <span>Subtotal</span>
            <strong>${total.toFixed(2)}</strong>
          </div>
          <p>Shipping and taxes calculated at checkout.</p>
          <button
            className="primary"
            disabled={!items.length}
            onClick={() => setCheckout(true)}
          >
            Checkout <ArrowRight size={18} />
          </button>
          {checkout && (
            <p role="status">
              Demo checkout ready — no payment will be collected.
            </p>
          )}
          <small>Thoughtfully made. Happily worn.</small>
        </footer>
      </section>
    </div>
  );
}
