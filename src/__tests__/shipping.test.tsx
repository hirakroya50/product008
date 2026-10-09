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
  it.each([
    [0, 0],
    [64, (64 / 190) * 100],
    [95, 50],
    [190, 100],
    [250, 100],
    [-10, 0],
  ])("clamps subtotal %s to progress %s", (total, expected) => {
    expect(shippingProgress(total)).toBe(expected);
  });

  it("uses the centralized $190 threshold", () => {
    expect(FREE_SHIPPING_THRESHOLD).toBe(190);
  });

  it.each([
    [0, "You're $190.00 away from free shipping."],
    [64, "You're $126.00 away from free shipping."],
    [-10, "You're $200.00 away from free shipping."],
  ])(
    "shows the correct remaining amount for subtotal %s",
    (subtotal, message) => {
      render(<ShippingProgress subtotal={subtotal} />);
      expect(screen.getByRole("status")).toHaveTextContent(message);
      expect(screen.getByRole("progressbar")).toHaveAttribute(
        "value",
        String(shippingProgress(subtotal)),
      );
    },
  );

  it.each([190, 250])("shows unlocked messaging at subtotal %s", (subtotal) => {
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
    const dialog = screen.getByRole("dialog", { name: "Shopping bag" });
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "You're $126.00 away from free shipping.",
    );
    expect(
      within(dialog.querySelector(".subtotal") as HTMLElement).getByText(
        "$64.00",
      ),
    ).toBeInTheDocument();
  });
});

it("returns to the full remaining amount after an unlocked subtotal becomes empty", () => {
  const view = render(<ShippingProgress subtotal={190} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "You unlocked free shipping!",
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "100");

  view.rerender(<ShippingProgress subtotal={0} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "You're $190.00 away from free shipping.",
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "0");
  expect(
    screen.queryByText("You unlocked free shipping!"),
  ).not.toBeInTheDocument();
});
