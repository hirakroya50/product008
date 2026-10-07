import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ShippingProgress,
  shippingProgress,
} from "../components/ShippingProgress";
import { CartDrawer } from "../components/CartDrawer";
import { products } from "../data/products";
describe("free shipping", () => {
  it.each([
    [0, 0],
    [37.5, 50],
    [75, 100],
    [100, 100],
    [-10, 0],
  ])("clamps subtotal %s to progress %s", (total, expected) => {
    expect(shippingProgress(total)).toBe(expected);
  });
  it("shows remaining dollars", () => {
    render(<ShippingProgress subtotal={32} />);
    expect(screen.getByRole("status")).toHaveTextContent("$43.00 away");
  });
  it("qualifies exactly at threshold", () => {
    render(<ShippingProgress subtotal={75} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "You unlocked free shipping",
    );
  });
  it("integrates with actual cart subtotal", () => {
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
    expect(screen.getByRole("status")).toHaveTextContent("$11.00 away");
  });
});

it("returns to the full remaining amount after an unlocked subtotal becomes empty", () => {
  const view = render(<ShippingProgress subtotal={75} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "You unlocked free shipping!",
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "100");
  view.rerender(<ShippingProgress subtotal={0} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "You're $75.00 away from free shipping.",
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "0");
  expect(
    screen.queryByText("You unlocked free shipping!"),
  ).not.toBeInTheDocument();
});
