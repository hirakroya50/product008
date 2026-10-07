import { useState } from "react";
import { ArrowDown, ArrowUpRight, Leaf, Package, Heart } from "lucide-react";
import { products } from "./data/products";
import type { CartItem, Product } from "./types/product";
import { addItem, changeQuantity } from "./cart";
import { Navbar } from "./components/Navbar";
import { ProductCard } from "./components/ProductCard";
import { CartDrawer } from "./components/CartDrawer";

export default function App() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("All threads");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("featured");
  const shown = products
    .filter(
      (p) =>
        (category === "All threads" || p.category === category) &&
        `${p.name} ${p.description}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "low"
        ? a.price - b.price
        : sort === "high"
          ? b.price - a.price
          : 0,
    );

  function add(p: Product, size: string, color: string) {
    setItems((i) => addItem(i, p, size, color));
    setOpen(true);
  }

  return (
    <>
      <Navbar
        count={items.reduce((s, i) => s + i.quantity, 0)}
        search={search}
        onSearch={setSearch}
        onCart={() => setOpen(true)}
      />
      <main>
        <section className="hero" id="story">
          <div className="hero-copy">
            <div className="eyebrow">
              <span /> THE EVERYDAY COLLECTION / 2026
            </div>
            <h1>
              Good threads.
              <br />
              Great <em>stories.</em>
            </h1>
            <p>
              Comfort you live in. Style that feels like you.
              <br />
              Meet your new everyday favorites.
            </p>
            <a className="primary" href="#catalog">
              Find your fit <ArrowUpRight size={19} />
            </a>
            <div className="hero-caption">
              100% personality. Zero overthinking.
            </div>
          </div>
          <div className="hero-art">
            <div className="art-circle" />
            <img
              src="/products/tee-1.svg"
              alt="ThreadCraft Out of Office graphic tee"
            />
            <div className="collection-note">
              THE OFF-DUTY EDIT
              <br />
              <strong>Made for your kind of day.</strong>
            </div>
            <span className="art-sticker">
              TAKE IT
              <br />
              EASY ↗
            </span>
          </div>
        </section>
        <section className="benefits">
          <span>
            <Leaf size={18} /> Better cotton, better comfort
          </span>
          <span>
            <Package size={18} /> Free shipping over $250
          </span>
          <span>
            <Heart size={18} /> Made to be your favorite
          </span>
        </section>
        <section id="catalog" className="catalog">
          <div className="catalog-title">
            <div className="eyebrow">THE GOOD STUFF</div>
            <h2>A little more you.</h2>
            <p>
              Your rotation starts here. <ArrowDown size={16} />
            </p>
          </div>
          <div className="catalog-controls">
            <div className="filters">
              {["All threads", "Graphic Tees", "Essentials", "Hoodies"].map(
                (c) => (
                  <button
                    key={c}
                    className={category === c ? "active" : ""}
                    onClick={() => setCategory(c)}
                  >
                    {c}
                  </button>
                ),
              )}
            </div>
            <label>
              {shown.length} styles{" "}
              <select
                aria-label="Sort products"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="featured">Sort: Featured</option>
                <option value="low">Price: Low to high</option>
                <option value="high">Price: High to low</option>
              </select>
            </label>
          </div>
          <div className="product-grid">
            {shown.map((p) => (
              <ProductCard key={p.id} product={p} onAdd={add} />
            ))}
          </div>
          {!shown.length && (
            <p className="no-results">
              No threads found. Try a different search.
            </p>
          )}
        </section>
      </main>
      <footer className="site-footer">
        <a className="brand" href="/">
          threadcraft®
        </a>
        <p>Wear your own story.</p>
        <span>© 2026 ThreadCraft · A Product 008 demo</span>
      </footer>
      {open && (
        <CartDrawer
          items={items}
          onClose={() => setOpen(false)}
          onQuantity={(key, delta) =>
            setItems((i) => changeQuantity(i, key, delta))
          }
        />
      )}
    </>
  );
}
