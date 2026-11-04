import prisma from "./db.server";

/**
 * Syncs full CartBoost config (shipping bar settings + all active BOGO offers)
 * to the shop-level app-owned metafield: $app:config
 */
export async function syncStorefrontMetafield(admin, shop) {
  try {
    const shopQuery = await admin.graphql(
      `#graphql
        query getShop {
          shop {
            id
          }
        }`
    );
    const shopData = await shopQuery.json();
    const shopId = shopData?.data?.shop?.id;
    if (!shopId) return;

    // 1. Fetch latest settings from DB
    let settings = await prisma.settings.findUnique({ where: { shop } });
    if (!settings) {
      settings = {
        enabled: true,
        thresholdAmount: 50,
        message: "You're {amount} away from FREE shipping!",
        successMessage: "Congratulations! You've unlocked FREE shipping!",
        emptyMessage: "Free shipping on orders over {amount}!",
        barColor: "#108043",
        barBgColor: "#e0e0e0",
        textColor: "#202223",
        barHeight: 8,
        barShape: "rounded",
      };
    }

    // 2. Fetch all active discount offers from DB
    const activeOffers = await prisma.discountOffer.findMany({
      where: { shop, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    });

    const formattedOffers = activeOffers.map((offer) => {
      let productIds = [];
      try {
        productIds = JSON.parse(offer.eligibleProductIds || "[]");
      } catch (e) {
        productIds = [];
      }

      return {
        id: offer.id,
        active: true,
        buyX: offer.buyQuantity,
        getY: offer.getQuantity,
        title: offer.title,
        appliesToAll: offer.appliesToAll,
        sameProductOnly: offer.sameProductOnly,
        eligibleProductIds: productIds,
      };
    });

    const configPayload = {
      enabled: settings.enabled,
      threshold: settings.thresholdAmount,
      message: settings.message,
      successMessage: settings.successMessage,
      emptyMessage: settings.emptyMessage,
      barColor: settings.barColor,
      barBgColor: settings.barBgColor,
      textColor: settings.textColor,
      barHeight: settings.barHeight,
      barShape: settings.barShape,
      bogoOffer: formattedOffers[0] || null, // Primary / latest active offer for backwards compatibility
      bogoOffers: formattedOffers, // Array of ALL active offers
    };

    const mutationRes = await admin.graphql(
      `#graphql
        mutation setShopMetafield($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              id
              value
            }
            userErrors {
              field
              message
            }
          }
        }`,
      {
        variables: {
          metafields: [
            {
              ownerId: shopId,
              namespace: "$app",
              key: "config",
              type: "json",
              value: JSON.stringify(configPayload),
            },
          ],
        },
      }
    );

    const result = await mutationRes.json();
    const userErrors = result?.data?.metafieldsSet?.userErrors;
    if (userErrors && userErrors.length > 0) {
      console.error("[CartBoost] syncStorefrontMetafield userErrors:", userErrors);
    } else {
      console.log(`[CartBoost] Metafield synced successfully with ${formattedOffers.length} active offers.`);
    }
  } catch (err) {
    console.error("[CartBoost] Error syncing storefront metafield:", err);
  }
}

