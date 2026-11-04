import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`[CartBoost] Received ${topic} compliance webhook for ${shop}`);

  // CartBoost does not store Customer Personally Identifiable Information (PII).
  // CartBoost only stores shop configuration (thresholds, appearance) and discount rules.
  // Shopify requires a 200 OK acknowledgment.
  return new Response(null, { status: 200 });
};

