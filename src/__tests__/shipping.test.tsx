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
    [-10, 0],
    [32, (32 / 199) * 100],
    [198, (198 / 199) * 100],
    [199, 100],
    [250, 100],
  ])("clamps subtotal %s to progress %s", (total, expected) => {
    expect(shippingProgress(total)).toBeCloseTo(expected);
  });

  it("shows the exact remaining dollars below the threshold", () => {
    render(<ShippingProgress subtotal={32} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "You're $167.00 away from free shipping.",
    );
    expect(
      screen.queryByText("You unlocked free shipping!"),
    ).not.toBeInTheDocument();
  });

  it("qualifies exactly at the threshold", () => {
    render(<ShippingProgress subtotal={199} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "You unlocked free shipping!",
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "100");
  });

  it("keeps the unlocked state above the threshold", () => {
    render(<ShippingProgress subtotal={250} />);

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
      "$135.00 away from free shipping.",
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
