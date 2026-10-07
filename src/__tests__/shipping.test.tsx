import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  FREE_SHIPPING_THRESHOLD,
  ShippingProgress,
  shippingProgress,
} from "../components/ShippingProgress";
import { CartDrawer } from "../components/CartDrawer";
import { products } from "../data/products";

describe("free shipping", () => {
  it("uses the inclusive $250 threshold", () => {
    expect(FREE_SHIPPING_THRESHOLD).toBe(250);
  });

  it.each([
    [0, 0],
    [32, 12.8],
    [125, 50],
    [250, 100],
    [300, 100],
    [-10, 0],
  ])("clamps subtotal %s to progress %s", (total, expected) => {
    expect(shippingProgress(total)).toBe(expected);
  });

  it("shows the exact remaining dollars below the threshold", () => {
    render(<ShippingProgress subtotal={32} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "You're $218.00 away from free shipping.",
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "12.8");
  });

  it.each([250, 300])("unlocks at or above the threshold", (subtotal) => {
    render(<ShippingProgress subtotal={subtotal} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "You unlocked free shipping!",
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "100");
  });

  it("integrates with the actual cart subtotal", () => {
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
      "You're $186.00 away from free shipping.",
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "25.6");
  });
});

it("recomputes the full remaining amount after an unlocked subtotal becomes empty", () => {
  const view = render(<ShippingProgress subtotal={250} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "You unlocked free shipping!",
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "100");

  view.rerender(<ShippingProgress subtotal={0} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "You're $250.00 away from free shipping.",
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "0");
  expect(
    screen.queryByText("You unlocked free shipping!"),
  ).not.toBeInTheDocument();
});
