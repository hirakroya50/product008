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
});
