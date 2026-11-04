import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`[CartBoost] Received ${topic} compliance webhook for ${shop}`);

  // When a store requests full data deletion (48 hours after app uninstall):
  // Clean up all shop records from the database to meet GDPR and Shopify App Store policies.
  try {
    await prisma.discountOffer.deleteMany({ where: { shop } });
    await prisma.settings.deleteMany({ where: { shop } });
    await prisma.session.deleteMany({ where: { shop } });
    console.log(`[CartBoost] Successfully purged all store records for ${shop}`);
  } catch (error) {
    console.error(`[CartBoost] Error purging data on shop/redact for ${shop}:`, error);
  }

  return new Response(null, { status: 200 });
};

