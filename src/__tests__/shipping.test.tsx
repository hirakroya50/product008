import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  FREE_SHIPPING_THRESHOLD,
  ShippingProgress,
  shippingProgress,
} from "../components/ShippingProgress";
import { CartDrawer } from "../components/CartDrawer";
import { products } from "../data/products";

describe("free shipping", () => {
  it("uses the shared $199 threshold", () => {
    expect(FREE_SHIPPING_THRESHOLD).toBe(199);
  });

  it.each([
    [0, 0],
    [64, (64 / 199) * 100],
    [199, 100],
    [250, 100],
    [-10, 0],
  ])("clamps subtotal %s to progress %s", (total, expected) => {
    expect(shippingProgress(total)).toBe(expected);
  });

  it("shows the correctly calculated remaining dollars below threshold", () => {
    render(<ShippingProgress subtotal={64} />);
    expect(screen.getByRole("status")).toHaveTextContent("$135.00 away");
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "value",
      `${(64 / 199) * 100}`,
    );
  });

  it("qualifies exactly at threshold", () => {
    render(<ShippingProgress subtotal={199} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "You unlocked free shipping",
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "100");
  });

  it("stays unlocked above threshold and clamps progress at 100", () => {
    render(<ShippingProgress subtotal={250} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "You unlocked free shipping",
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "100");
  });

  it("clamps non-positive totals to zero and shows the full remaining amount", () => {
    const view = render(<ShippingProgress subtotal={0} />);
    let shipping = within(
      screen.getByRole("region", { name: "Free shipping progress" }),
    );
    expect(shipping.getByRole("status")).toHaveTextContent(
      "You're $199.00 away from free shipping.",
    );
    expect(shipping.getByRole("progressbar")).toHaveAttribute("value", "0");

    view.rerender(<ShippingProgress subtotal={-10} />);
    shipping = within(
      screen.getByRole("region", { name: "Free shipping progress" }),
    );
    expect(shipping.getByRole("status")).toHaveTextContent(
      "You're $209.00 away from free shipping.",
    );
    expect(shipping.getByRole("progressbar")).toHaveAttribute("value", "0");
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
    const shipping = within(
      screen.getByRole("region", { name: "Free shipping progress" }),
    );
    expect(shipping.getByRole("status")).toHaveTextContent("$135.00 away");
    expect(shipping.getByRole("progressbar")).toHaveAttribute(
      "value",
      `${(64 / 199) * 100}`,
    );
  });
});

it("returns to the full remaining amount after an unlocked subtotal becomes empty", () => {
  const view = render(<ShippingProgress subtotal={199} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "You unlocked free shipping!",
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "100");
  view.rerender(<ShippingProgress subtotal={0} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "You're $199.00 away from free shipping.",
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "0");
  expect(
    screen.queryByText("You unlocked free shipping!"),
  ).not.toBeInTheDocument();
});
