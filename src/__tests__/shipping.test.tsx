import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  FREE_SHIPPING_THRESHOLD,
  ShippingProgress,
  shippingProgress,
} from "../components/ShippingProgress";
import { CartDrawer } from "../components/CartDrawer";
import { products } from "../data/products";
import App from "../App";

describe("free shipping", () => {
  it("uses the $2500 threshold", () => {
    expect(FREE_SHIPPING_THRESHOLD).toBe(2500);
  });

  it.each([
    [-10, 0],
    [0, 0],
    [1250, 50],
    [2500, 100],
    [2750, 100],
  ])("clamps subtotal %s to progress %s", (total, expected) => {
    expect(shippingProgress(total)).toBe(expected);
  });

  it("calculates representative below-threshold progress", () => {
    expect(shippingProgress(2499)).toBeCloseTo(99.96, 10);
  });

  it("shows representative remaining dollar amounts", () => {
    const { rerender } = render(<ShippingProgress subtotal={32} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "You're $2468.00 away from free shipping.",
    );

    rerender(<ShippingProgress subtotal={1250} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "You're $1250.00 away from free shipping.",
    );

    rerender(<ShippingProgress subtotal={2499.99} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "You're $0.01 away from free shipping.",
    );
  });

  it("qualifies exactly at the threshold", () => {
    const { rerender } = render(<ShippingProgress subtotal={2500} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "You unlocked free shipping",
    );
    expect(screen.getByRole("progressbar")).toHaveValue(100);

    rerender(<ShippingProgress subtotal={3000} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "You unlocked free shipping",
    );
    expect(screen.getByRole("progressbar")).toHaveValue(100);
  });

  it("integrates with the actual calculated cart subtotal", () => {
    render(
      <CartDrawer
        items={[
          {
            product: products[0],
            size: "M",
            color: products[0].colors[0],
            quantity: 2,
          },
        ]}
        onClose={() => {}}
        onQuantity={() => {}}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "You're $2436.00 away from free shipping.",
    );
  });

  it("keeps the customer-facing offer copy synchronized", () => {
    render(<App />);

    expect(
      screen.getByText(/Free shipping on orders \$2500\+/),
    ).toBeInTheDocument();
    expect(screen.getByText("Free shipping over $2500")).toBeInTheDocument();
    expect(screen.queryByText(/\$75/)).not.toBeInTheDocument();
  });
});
