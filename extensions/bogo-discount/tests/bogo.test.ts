/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import { run } from "../src/run";

function createMockCart(lines: Array<{
  id: string;
  quantity: number;
  price: string;
  productId?: string;
}>) {
  return {
    lines: lines.map((l) => ({
      id: l.id,
      quantity: l.quantity,
      cost: {
        amountPerQuantity: {
          amount: l.price,
          currencyCode: "USD",
        },
      },
      merchandise: {
        __typename: "ProductVariant" as const,
        id: `gid://shopify/ProductVariant/${l.id}`,
        product: {
          id: l.productId ?? `gid://shopify/Product/${l.id}`,
        },
      },
    })),
  };
}

describe("BOGO Discount Function (Buy X Get Y Free)", () => {
  const bogoMetafield = (config: Record<string, any> = {}) => ({
    discountNode: {
      metafield: {
        value: JSON.stringify({
          buyQuantity: 2,
          getQuantity: 1,
          discountPercentage: 100,
          appliesToAll: true,
          title: "Buy 2 Get 1 FREE",
          ...config,
        }),
      },
    },
  });

  it("1 item in cart: returns no discounts", () => {
    const input: any = {
      ...bogoMetafield(),
      cart: createMockCart([{ id: "line1", quantity: 1, price: "20.00" }]),
    };
    const result = run(input);
    expect(result.discounts).toHaveLength(0);
  });

  it("2 items in cart: returns no discounts (needs 3 for Buy 2 Get 1)", () => {
    const input: any = {
      ...bogoMetafield(),
      cart: createMockCart([
        { id: "line1", quantity: 1, price: "20.00" },
        { id: "line2", quantity: 1, price: "30.00" },
      ]),
    };
    const result = run(input);
    expect(result.discounts).toHaveLength(0);
  });

  it("3 items in cart: gives 1 cheapest item free", () => {
    const input: any = {
      ...bogoMetafield(),
      cart: createMockCart([
        { id: "line1", quantity: 1, price: "50.00" },
        { id: "line2", quantity: 1, price: "40.00" },
        { id: "line3", quantity: 1, price: "15.00" }, // cheapest
      ]),
    };
    const result = run(input);
    expect(result.discounts).toHaveLength(1);
    expect(result.discounts[0].targets).toEqual([
      { cartLine: { id: "line3", quantity: 1 } },
    ]);
    expect(result.discounts[0].value.percentage?.value).toBe(100);
  });

  it("4 items in cart: gives 1 cheapest item free", () => {
    const input: any = {
      ...bogoMetafield(),
      cart: createMockCart([
        { id: "line1", quantity: 1, price: "50.00" },
        { id: "line2", quantity: 1, price: "40.00" },
        { id: "line3", quantity: 1, price: "30.00" },
        { id: "line4", quantity: 1, price: "10.00" }, // cheapest
      ]),
    };
    const result = run(input);
    expect(result.discounts).toHaveLength(1);
    expect(result.discounts[0].targets).toEqual([
      { cartLine: { id: "line4", quantity: 1 } },
    ]);
  });

  it("6 items in cart: gives 2 cheapest items free (2 complete bundles)", () => {
    const input: any = {
      ...bogoMetafield(),
      cart: createMockCart([
        { id: "line1", quantity: 1, price: "10.00" }, // cheapest 1
        { id: "line2", quantity: 1, price: "15.00" }, // cheapest 2
        { id: "line3", quantity: 1, price: "25.00" },
        { id: "line4", quantity: 1, price: "35.00" },
        { id: "line5", quantity: 1, price: "45.00" },
        { id: "line6", quantity: 1, price: "55.00" },
      ]),
    };
    const result = run(input);
    expect(result.discounts).toHaveLength(1);
    expect(result.discounts[0].targets).toEqual([
      { cartLine: { id: "line1", quantity: 1 } },
      { cartLine: { id: "line2", quantity: 1 } },
    ]);
  });

  it("handles quantities greater than 1 on a single line", () => {
    const input: any = {
      ...bogoMetafield(),
      cart: createMockCart([
        { id: "line1", quantity: 3, price: "25.00" }, // 3 units of same item
      ]),
    };
    const result = run(input);
    expect(result.discounts).toHaveLength(1);
    expect(result.discounts[0].targets).toEqual([
      { cartLine: { id: "line1", quantity: 1 } }, // 1 unit free out of 3
    ]);
  });

  it("mixed prices and quantities: discounts lowest priced units", () => {
    const input: any = {
      ...bogoMetafield(),
      cart: createMockCart([
        { id: "lineA", quantity: 2, price: "50.00" }, // $50, $50
        { id: "lineB", quantity: 2, price: "20.00" }, // $20, $20
      ]), // total 4 items -> 1 free bundle -> cheapest unit is $20 on lineB
    };
    const result = run(input);
    expect(result.discounts).toHaveLength(1);
    expect(result.discounts[0].targets).toEqual([
      { cartLine: { id: "lineB", quantity: 1 } },
    ]);
  });

  it("ignores zero or negative price lines (already discounted or free lines)", () => {
    const input: any = {
      ...bogoMetafield(),
      cart: createMockCart([
        { id: "freeLine", quantity: 1, price: "0.00" },
        { id: "line1", quantity: 2, price: "30.00" },
      ]),
    };
    const result = run(input);
    expect(result.discounts).toHaveLength(0); // Only 2 paid items, 0 is ignored
  });

  it("out-of-stock / quantity 0 edge cases are ignored", () => {
    const input: any = {
      ...bogoMetafield(),
      cart: createMockCart([
        { id: "oosLine", quantity: 0, price: "10.00" },
        { id: "line1", quantity: 2, price: "30.00" },
      ]),
    };
    const result = run(input);
    expect(result.discounts).toHaveLength(0);
  });

  it("filters by eligibleProductIds when configured", () => {
    const input: any = {
      ...bogoMetafield({
        appliesToAll: false,
        eligibleProductIds: ["gid://shopify/Product/eligible1", "gid://shopify/Product/eligible2"],
      }),
      cart: createMockCart([
        { id: "line1", quantity: 2, price: "30.00", productId: "gid://shopify/Product/eligible1" },
        { id: "line2", quantity: 1, price: "10.00", productId: "gid://shopify/Product/eligible2" },
        { id: "line3", quantity: 5, price: "100.00", productId: "gid://shopify/Product/nonEligible" },
      ]),
    };
    const result = run(input);
    expect(result.discounts).toHaveLength(1);
    // Eligible count is 2 + 1 = 3 items. Cheapest eligible item is line2 ($10)
    expect(result.discounts[0].targets).toEqual([
      { cartLine: { id: "line2", quantity: 1 } },
    ]);
  });

  it("sameProductOnly mode requires units to belong to the same product", () => {
    const inputDifferentProducts: any = {
      ...bogoMetafield({ sameProductOnly: true }),
      cart: createMockCart([
        { id: "line1", quantity: 2, price: "30.00", productId: "gid://shopify/Product/A" },
        { id: "line2", quantity: 1, price: "30.00", productId: "gid://shopify/Product/B" },
      ]),
    };
    expect(run(inputDifferentProducts).discounts).toHaveLength(0);

    const inputSameProduct: any = {
      ...bogoMetafield({ sameProductOnly: true }),
      cart: createMockCart([
        { id: "line1", quantity: 3, price: "30.00", productId: "gid://shopify/Product/A" },
      ]),
    };
    const result = run(inputSameProduct);
    expect(result.discounts).toHaveLength(1);
    expect(result.discounts[0].targets).toEqual([
      { cartLine: { id: "line1", quantity: 1 } },
    ]);
  });
});
