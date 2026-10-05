import type { CartItem, Product } from "./types/product";
export const cartKey = (item: Pick<CartItem, "product" | "size" | "color">) =>
  `${item.product.id}:${item.size}:${item.color}`;
export const subtotal = (items: CartItem[]) =>
  Math.round(
    items.reduce((sum, item) => sum + item.product.price * item.quantity, 0) *
      100,
  ) / 100;
export function addItem(
  items: CartItem[],
  product: Product,
  size: string,
  color: string,
): CartItem[] {
  if (
    !product.inStock ||
    !product.sizes.includes(size) ||
    !product.colors.includes(color)
  )
    return items;
  const total = items
    .filter((i) => i.product.id === product.id)
    .reduce((s, i) => s + i.quantity, 0);
  if (total >= product.stockCount) return items;
  const incoming = { product, size, color, quantity: 1 };
  const key = cartKey(incoming);
  return items.some((i) => cartKey(i) === key)
    ? items.map((i) =>
        cartKey(i) === key ? { ...i, quantity: i.quantity + 1 } : i,
      )
    : [...items, incoming];
}
export function changeQuantity(
  items: CartItem[],
  key: string,
  delta: number,
): CartItem[] {
  return items
    .map((i) => {
      if (cartKey(i) !== key) return i;
      const total = items
        .filter((x) => x.product.id === i.product.id)
        .reduce((s, x) => s + x.quantity, 0);
      return {
        ...i,
        quantity:
          delta > 0 && total >= i.product.stockCount
            ? i.quantity
            : i.quantity + delta,
      };
    })
    .filter((i) => i.quantity > 0);
}
