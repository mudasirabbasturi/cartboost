import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`[CartBoost] Received ${topic} compliance webhook for ${shop}`);

  // CartBoost does not collect or persist customer records, email lists, or profiles.
  // We return HTTP 200 OK to confirm compliance.
  return new Response(null, { status: 200 });
};

