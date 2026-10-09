import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  FREE_SHIPPING_THRESHOLD,
  ShippingProgress,
  shippingProgress,
} from "../components/ShippingProgress";
import { CartDrawer } from "../components/CartDrawer";
import { Navbar } from "../components/Navbar";
import { products } from "../data/products";

describe("free shipping", () => {
  it.each([
    [0, 0],
    [97.5, 50],
    [195, 100],
    [250, 100],
    [-10, 0],
  ])("clamps subtotal %s to progress %s", (total, expected) => {
    expect(shippingProgress(total)).toBe(expected);
  });

  it("uses the shared 195 dollar threshold", () => {
    expect(FREE_SHIPPING_THRESHOLD).toBe(195);
  });

  it("shows remaining dollars below the threshold", () => {
    render(<ShippingProgress subtotal={100} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "You're $95.00 away from free shipping.",
    );
  });

  it("qualifies exactly at the threshold and remains qualified above it", () => {
    const view = render(<ShippingProgress subtotal={195} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "You unlocked free shipping!",
    );

    view.rerender(<ShippingProgress subtotal={250} />);
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
      "You're $131.00 away from free shipping.",
    );
  });

  it("shows the Navbar announcement for the new offer", () => {
    render(
      <Navbar count={0} search="" onSearch={() => {}} onCart={() => {}} />,
    );
    expect(
      screen.getByText(/Free shipping on orders \$195\+/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Free shipping on orders \$75\+/),
    ).not.toBeInTheDocument();
  });
});

it("resets to the full remaining amount after an unlocked subtotal becomes empty", () => {
  const view = render(<ShippingProgress subtotal={195} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "You unlocked free shipping!",
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "100");

  view.rerender(<ShippingProgress subtotal={0} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "You're $195.00 away from free shipping.",
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "0");

  view.rerender(<ShippingProgress subtotal={-10} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "You're $195.00 away from free shipping.",
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "0");
  expect(
    screen.queryByText("You unlocked free shipping!"),
  ).not.toBeInTheDocument();
});
