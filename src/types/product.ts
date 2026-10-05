export interface Product {
  id: string;
  name: string;
  price: number;
  description: string;
  sizes: string[];
  colors: string[];
  inStock: boolean;
  stockCount: number;
  image: string;
  category: string;
}
export interface CartItem {
  product: Product;
  size: string;
  color: string;
  quantity: number;
}
