import { useState } from "react";
import { Plus } from "lucide-react";
import { clsx } from "clsx";
import type { Product } from "../types/product";
export function ProductCard({
  product,
  onAdd,
}: {
  product: Product;
  onAdd: (p: Product, size: string, color: string) => void;
}) {
  const [size, setSize] = useState(product.sizes[0]);
  const [color, setColor] = useState(product.colors[0]);
  return (
    <article className="product-card">
      <div className="product-image">
        <img src={product.image} alt={product.name} />
        <span className={clsx("stock", !product.inStock && "sold")}>
          {product.inStock ? "In Stock" : "Sold Out"}
        </span>
        <span className="category-tag">{product.category}</span>
      </div>
      <div className="product-heading">
        <h3>{product.name}</h3>
        <strong>${product.price.toFixed(2)}</strong>
      </div>
      <p>{product.description}</p>
      <div className="variants">
        <div className="sizes" aria-label="Size">
          {product.sizes.map((s) => (
            <button
              key={s}
              aria-label={`${product.name} size ${s}`}
              aria-pressed={size === s}
              className={clsx(size === s && "selected")}
              onClick={() => setSize(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="swatches">
          {product.colors.map((c) => (
            <button
              key={c}
              aria-label={`${product.name} color ${c}`}
              aria-pressed={color === c}
              className={clsx(color === c && "selected")}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </div>
      <button
        className="add-button"
        disabled={!product.inStock}
        onClick={() => onAdd(product, size, color)}
      >
        {product.inStock ? "Add to bag" : "Currently unavailable"}
        <Plus size={16} />
      </button>
    </article>
  );
}
