import type {
  RunInput,
  FunctionRunResult,
  Target,
} from "../generated/api";
import {
  DiscountApplicationStrategy,
} from "../generated/api";

const EMPTY_DISCOUNT: FunctionRunResult = {
  discountApplicationStrategy: DiscountApplicationStrategy.First,
  discounts: [],
};

export interface Configuration {
  buyQuantity?: number; // X (e.g. 2 for Buy 2)
  getQuantity?: number; // Y (e.g. 1 for Get 1 Free)
  discountPercentage?: number; // 100 for FREE
  appliesToAll?: boolean;
  eligibleProductIds?: string[];
  sameProductOnly?: boolean;
  title?: string;
}

export function run(input: RunInput): FunctionRunResult {
  // Parse configuration from discount metafield
  let config: Configuration = {};
  try {
    const rawConfig = input?.discountNode?.metafield?.value;
    if (rawConfig) {
      config = JSON.parse(rawConfig);
    }
  } catch (e) {
    config = {};
  }

  const buyX = Math.max(1, config.buyQuantity ?? 2);
  const getY = Math.max(1, config.getQuantity ?? 1);
  const bundleSize = buyX + getY;
  const discountPercent = config.discountPercentage ?? 100;
  const sameProductOnly = Boolean(config.sameProductOnly);
  const appliesToAll = config.appliesToAll ?? true;
  const eligibleProductIds = Array.isArray(config.eligibleProductIds)
    ? config.eligibleProductIds
    : [];

  const lines = input.cart?.lines ?? [];
  if (!lines.length) {
    return EMPTY_DISCOUNT;
  }

  // Filter lines eligible for this offer
  const eligibleLines = lines.filter((line) => {
    if (!line.quantity || line.quantity <= 0) return false;
    const unitPrice = parseFloat(line.cost?.amountPerQuantity?.amount ?? "0");
    if (unitPrice <= 0) return false;

    if (!appliesToAll && eligibleProductIds.length > 0) {
      if (line.merchandise.__typename === "ProductVariant") {
        const productId = line.merchandise.product?.id;
        if (!productId || !eligibleProductIds.includes(productId)) {
          return false;
        }
      } else {
        return false;
      }
    }
    return true;
  });

  if (!eligibleLines.length) {
    return EMPTY_DISCOUNT;
  }

  const targets: Target[] = [];

  if (sameProductOnly) {
    // Group eligible items by product
    const productGroups = new Map<string, typeof eligibleLines>();
    for (const line of eligibleLines) {
      const productId =
        line.merchandise.__typename === "ProductVariant"
          ? line.merchandise.product?.id ?? line.id
          : line.id;

      if (!productGroups.has(productId)) {
        productGroups.set(productId, []);
      }
      productGroups.get(productId)!.push(line);
    }

    for (const [, groupLines] of productGroups) {
      const totalUnits = groupLines.reduce((sum, l) => sum + l.quantity, 0);
      const bundles = Math.floor(totalUnits / bundleSize);
      const freeUnitsToGive = bundles * getY;

      if (freeUnitsToGive <= 0) continue;

      // Expand into individual units sorted cheapest first
      const units: { lineId: string; price: number }[] = [];
      for (const line of groupLines) {
        const price = parseFloat(line.cost?.amountPerQuantity?.amount ?? "0");
        for (let i = 0; i < line.quantity; i++) {
          units.push({ lineId: line.id, price });
        }
      }
      units.sort((a, b) => a.price - b.price);

      const allocation = new Map<string, number>();
      for (let i = 0; i < freeUnitsToGive && i < units.length; i++) {
        const u = units[i];
        allocation.set(u.lineId, (allocation.get(u.lineId) || 0) + 1);
      }

      for (const [lineId, qty] of allocation) {
        targets.push({
          cartLine: {
            id: lineId,
            quantity: qty,
          },
        });
      }
    }
  } else {
    // Cross-product mix & match
    const totalUnits = eligibleLines.reduce((sum, l) => sum + l.quantity, 0);
    const bundles = Math.floor(totalUnits / bundleSize);
    const freeUnitsToGive = bundles * getY;

    if (freeUnitsToGive <= 0) {
      return EMPTY_DISCOUNT;
    }

    // Expand all units and sort by unit price ascending (cheapest items are free)
    const units: { lineId: string; price: number }[] = [];
    for (const line of eligibleLines) {
      const price = parseFloat(line.cost?.amountPerQuantity?.amount ?? "0");
      for (let i = 0; i < line.quantity; i++) {
        units.push({ lineId: line.id, price });
      }
    }
    units.sort((a, b) => a.price - b.price);

    const allocation = new Map<string, number>();
    for (let i = 0; i < freeUnitsToGive && i < units.length; i++) {
      const u = units[i];
      allocation.set(u.lineId, (allocation.get(u.lineId) || 0) + 1);
    }

    for (const [lineId, qty] of allocation) {
      targets.push({
        cartLine: {
          id: lineId,
          quantity: qty,
        },
      });
    }
  }

  if (!targets.length) {
    return EMPTY_DISCOUNT;
  }

  return {
    discountApplicationStrategy: DiscountApplicationStrategy.First,
    discounts: [
      {
        message: config.title || `Buy ${buyX} Get ${getY} FREE`,
        targets,
        value: {
          percentage: {
            value: discountPercent,
          },
        },
      },
    ],
  };
}
