import { Search, ShoppingBag, ArrowUpRight } from "lucide-react";
interface Props {
  count: number;
  search: string;
  onSearch: (value: string) => void;
  onCart: () => void;
}
export function Navbar({ count, search, onSearch, onCart }: Props) {
  return (
    <>
      <div className="announcement">
        Good threads. Better days.{" "}
        <span>
          Free shipping on orders $2500+ <ArrowUpRight size={12} />
        </span>
      </div>
      <nav className="navbar">
        <a className="brand" href="/">
          threadcraft<span>®</span>
        </a>
        <div className="nav-links">
          <a href="#catalog">Shop all</a>
          <a href="#story">Our story</a>
        </div>
        <label className="search">
          <Search size={17} />
          <input
            aria-label="Search products"
            placeholder="Find your next favorite"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </label>
        <button
          className="cart-button"
          onClick={onCart}
          aria-label={`Open cart, ${count} items`}
        >
          <ShoppingBag size={21} />
          <span>Bag</span>
          <b>{count}</b>
        </button>
      </nav>
    </>
  );
}
