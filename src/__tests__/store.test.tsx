import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { products } from "../data/products";
import { addItem, cartKey, changeQuantity, subtotal } from "../cart";
import { ProductCard } from "../components/ProductCard";
import App from "../App";

describe("ThreadCraft", () => {
  it("merges matching variants and calculates subtotal", () => {
    const items = addItem(
      addItem([], products[0], "M", products[0].colors[0]),
      products[0],
      "M",
      products[0].colors[0],
    );
    expect(items).toHaveLength(1);
    expect(subtotal(items)).toBe(64);
    expect(changeQuantity(items, cartKey(items[0]), -1)[0].quantity).toBe(1);
  });

  it("keeps variants separate and removes zero quantity", () => {
    const items = addItem(
      addItem([], products[0], "M", products[0].colors[0]),
      products[0],
      "L",
      products[0].colors[0],
    );
    expect(items).toHaveLength(2);
    expect(changeQuantity(items, cartKey(items[0]), -1)).toHaveLength(1);
  });

  it("enforces stock across variants", () => {
    const p = { ...products[0], stockCount: 1 };
    const items = addItem([], p, "M", p.colors[0]);
    expect(addItem(items, p, "L", p.colors[0])).toEqual(items);
    expect(changeQuantity(items, cartKey(items[0]), 1)).toEqual(items);
  });

  it("disables sold-out purchase", () => {
    const onAdd = vi.fn();
    render(<ProductCard product={products[4]} onAdd={onAdd} />);
    const button = screen.getByRole("button", {
      name: /Currently unavailable/,
    });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onAdd).not.toHaveBeenCalled();
    expect(addItem([], products[4], "S", products[4].colors[0])).toEqual([]);
  });

  it("filters and sorts the catalog", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Hoodies" }));
    expect(screen.getByText("The Weekend Hoodie")).toBeInTheDocument();
    expect(screen.queryByText("Out of Office")).not.toBeInTheDocument();
  });

  it("distinguishes category filters from repeated product tags", () => {
    render(<App />);
    expect(() => screen.getByText("Graphic Tees")).toThrow(
      /multiple elements/i,
    );
    const filter = screen.getByRole("button", { name: "Graphic Tees" });
    const card = screen
      .getByRole("heading", { name: "Out of Office" })
      .closest("article");
    expect(card).toBeInTheDocument();
    expect(within(card!).getByText("Graphic Tees")).toHaveClass("category-tag");
    fireEvent.click(filter);
    expect(filter).toHaveClass("active");
    expect(screen.queryByText("The Weekend Hoodie")).not.toBeInTheDocument();
  });

  it("adds to drawer and modifies quantity", () => {
    render(<App />);
    fireEvent.click(screen.getAllByRole("button", { name: /Add to bag/ })[0]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByText("$32.00").length).toBeGreaterThan(0);
    fireEvent.click(
      screen.getByRole("button", { name: "Increase Out of Office" }),
    );
    expect(screen.getAllByText("$64.00")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    expect(screen.getByText(/Demo checkout ready/)).toHaveAttribute(
      "role",
      "status",
    );
  });

  it("shares stock across drawer variants and distinguishes line totals from subtotal", () => {
    render(<App />);
    const card = screen
      .getByRole("heading", { name: "Out of Office" })
      .closest("article")!;
    const product = within(card);
    fireEvent.click(
      product.getByRole("button", { name: "Out of Office size M" }),
    );
    fireEvent.click(product.getByRole("button", { name: "Add to bag" }));
    fireEvent.click(screen.getByRole("button", { name: "Close cart" }));
    fireEvent.click(
      product.getByRole("button", { name: "Out of Office size L" }),
    );
    fireEvent.click(product.getByRole("button", { name: "Add to bag" }));

    const dialog = screen.getByRole("dialog", { name: "Shopping bag" });
    const lines = dialog.querySelectorAll<HTMLElement>(".cart-item");
    expect(lines).toHaveLength(2);
    expect(within(lines[0]).getByText(/Size M/)).toBeInTheDocument();
    expect(within(lines[1]).getByText(/Size L/)).toBeInTheDocument();
    const first = within(lines[0]);
    const second = within(lines[1]);
    const total = within(dialog.querySelector<HTMLElement>(".subtotal")!);
    const increase = first.getByRole("button", {
      name: "Increase Out of Office",
    });
    for (let i = 0; i < 10; i++) fireEvent.click(increase);
    expect(first.getByText("11")).toBeInTheDocument();
    expect(second.getByText("1")).toBeInTheDocument();
    expect(first.getByText("$352.00")).toBeInTheDocument();
    expect(second.getByText("$32.00")).toBeInTheDocument();
    expect(total.getByText("$384.00")).toBeInTheDocument();

    fireEvent.click(increase);
    fireEvent.click(
      second.getByRole("button", { name: "Increase Out of Office" }),
    );
    expect(first.getByText("11")).toBeInTheDocument();
    expect(second.getByText("1")).toBeInTheDocument();
    expect(total.getByText("$384.00")).toBeInTheDocument();

    fireEvent.click(
      first.getByRole("button", { name: "Decrease Out of Office" }),
    );
    expect(first.getByText("10")).toBeInTheDocument();
    expect(first.getByText("$320.00")).toBeInTheDocument();
    expect(second.getByText("$32.00")).toBeInTheDocument();
    expect(total.getByText("$352.00")).toBeInTheDocument();
    expect(within(dialog).getAllByText("$352.00")).toHaveLength(1);

    fireEvent.click(
      second.getByRole("button", { name: "Decrease Out of Office" }),
    );
    expect(dialog.querySelectorAll(".cart-item")).toHaveLength(1);
    expect(total.getByText("$320.00")).toBeInTheDocument();
    fireEvent.click(increase);
    fireEvent.click(increase);
    fireEvent.click(increase);
    expect(first.getByText("12")).toBeInTheDocument();
    expect(total.getByText("$384.00")).toBeInTheDocument();
  });
});

it("recomputes shipping when the final cart item is removed", () => {
  render(<App />);
  const card = screen
    .getByRole("heading", { name: "Out of Office" })
    .closest("article")!;
  fireEvent.click(within(card).getByRole("button", { name: "Add to bag" }));
  const dialog = screen.getByRole("dialog", { name: "Shopping bag" });
  const shipping = within(
    within(dialog).getByRole("region", { name: "Free shipping progress" }),
  );
  const total = within(dialog.querySelector<HTMLElement>(".subtotal")!);
  const increase = within(dialog).getByRole("button", {
    name: "Increase Out of Office",
  });
  fireEvent.click(increase);
  fireEvent.click(increase);
  expect(total.getByText("$96.00")).toBeInTheDocument();
  expect(shipping.getByRole("status")).toHaveTextContent(
    "You're $154.00 away from free shipping.",
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Checkout" }));
  expect(within(dialog).getAllByRole("status")).toHaveLength(2);
  const decrease = within(dialog).getByRole("button", {
    name: "Decrease Out of Office",
  });
  fireEvent.click(decrease);
  expect(total.getByText("$64.00")).toBeInTheDocument();
  expect(shipping.getByRole("status")).toHaveTextContent(
    "You're $186.00 away from free shipping.",
  );
  fireEvent.click(decrease);
  fireEvent.click(decrease);
  expect(dialog.querySelectorAll(".cart-item")).toHaveLength(0);
  expect(total.getByText("$0.00")).toBeInTheDocument();
  expect(shipping.getByRole("status")).toHaveTextContent(
    "You're $250.00 away from free shipping.",
  );
  expect(shipping.getByRole("progressbar")).toHaveAttribute("value", "0");
  expect(
    shipping.queryByText("You unlocked free shipping!"),
  ).not.toBeInTheDocument();
});
