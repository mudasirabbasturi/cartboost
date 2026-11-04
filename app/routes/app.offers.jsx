import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncStorefrontMetafield } from "../metafield.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const offers = await prisma.discountOffer.findMany({
    where: { shop, status: { not: "DELETED" } },
    orderBy: { createdAt: "desc" },
  });

  // Fetch products for product picker
  let products = [];
  try {
    const productsRes = await admin.graphql(
      `#graphql
        query getProducts {
          products(first: 25) {
            nodes {
              id
              title
              featuredImage {
                url
              }
            }
          }
        }`
    );
    const pData = await productsRes.json();
    products = pData?.data?.products?.nodes || [];
  } catch (e) {
    console.warn("Unable to fetch products:", e);
  }

  return {
    shop,
    offers,
    products,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    const title = formData.get("title") || "Buy 2 Get 1 FREE";
    const buyQuantity = parseInt(formData.get("buyQuantity"), 10) || 2;
    const getQuantity = parseInt(formData.get("getQuantity"), 10) || 1;
    const appliesToAll = formData.get("appliesToAll") === "true";
    const sameProductOnly = formData.get("sameProductOnly") === "true";
    const combinesWithOrder = formData.get("combinesWithOrder") === "true";
    const combinesWithProduct = formData.get("combinesWithProduct") === "true";
    const combinesWithShipping = formData.get("combinesWithShipping") === "true";
    const eligibleProductIds = formData.get("eligibleProductIds") || "[]";

    let functionId = null;
    try {
      const fnRes = await admin.graphql(
        `#graphql
          query getFunctions {
            shopifyFunctions(first: 25) {
              nodes {
                id
                title
                apiType
              }
            }
          }`
      );
      const fnData = await fnRes.json();
      const fnNode = fnData?.data?.shopifyFunctions?.nodes?.find(
        (n) => n.title === "bogo-discount" || n.apiType === "product_discounts"
      );
      if (fnNode) {
        functionId = fnNode.id;
      }
    } catch (e) {
      console.warn("Failed to find shopifyFunction ID:", e);
    }

    const functionConfig = {
      buyQuantity,
      getQuantity,
      discountPercentage: 100,
      appliesToAll,
      eligibleProductIds: JSON.parse(eligibleProductIds),
      sameProductOnly,
      title,
    };

    let shopifyDiscountId = null;
    try {
      const discountInput = {
        title,
        startsAt: new Date().toISOString(),
        combinesWith: {
          orderDiscounts: combinesWithOrder,
          productDiscounts: combinesWithProduct,
          shippingDiscounts: combinesWithShipping,
        },
        metafields: [
          {
            namespace: "$app:bogo-discount",
            key: "function-configuration",
            type: "json",
            value: JSON.stringify(functionConfig),
          },
        ],
      };

      if (functionId) {
        discountInput.functionId = functionId;
      } else {
        discountInput.functionHandle = "bogo-discount";
      }

      const createRes = await admin.graphql(
        `#graphql
          mutation createAutomaticDiscount($automaticAppDiscount: DiscountAutomaticAppInput!) {
            discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
              automaticAppDiscount {
                discountId
                title
                status
              }
              userErrors {
                field
                message
                code
              }
            }
          }`,
        {
          variables: {
            automaticAppDiscount: discountInput,
          },
        }
      );

      const createData = await createRes.json();
      shopifyDiscountId =
        createData?.data?.discountAutomaticAppCreate?.automaticAppDiscount
          ?.discountId;

      const userErrors =
        createData?.data?.discountAutomaticAppCreate?.userErrors;
      if (userErrors && userErrors.length > 0) {
        console.error("Shopify discount create userErrors:", userErrors);
      }
    } catch (e) {
      console.error("Error creating automatic discount on Shopify:", e);
    }

    const newOffer = await prisma.discountOffer.create({
      data: {
        shop,
        shopifyDiscountId,
        title,
        buyQuantity,
        getQuantity,
        discountPercentage: 100,
        appliesToAll,
        eligibleProductIds,
        sameProductOnly,
        combinesWithOrder,
        combinesWithProduct,
        combinesWithShipping,
        status: "ACTIVE",
      },
    });

    await syncStorefrontMetafield(admin, shop);

    return { success: true, message: "Offer created successfully!" };
  }

  if (intent === "update") {
    const offerId = formData.get("offerId");
    const title = formData.get("title") || "Buy 2 Get 1 FREE";
    const buyQuantity = parseInt(formData.get("buyQuantity"), 10) || 2;
    const getQuantity = parseInt(formData.get("getQuantity"), 10) || 1;
    const appliesToAll = formData.get("appliesToAll") === "true";
    const sameProductOnly = formData.get("sameProductOnly") === "true";
    const combinesWithOrder = formData.get("combinesWithOrder") === "true";
    const combinesWithProduct = formData.get("combinesWithProduct") === "true";
    const combinesWithShipping = formData.get("combinesWithShipping") === "true";
    const eligibleProductIds = formData.get("eligibleProductIds") || "[]";

    const offer = await prisma.discountOffer.findUnique({
      where: { id: offerId },
    });

    const functionConfig = {
      buyQuantity,
      getQuantity,
      discountPercentage: 100,
      appliesToAll,
      eligibleProductIds: JSON.parse(eligibleProductIds),
      sameProductOnly,
      title,
    };

    if (offer?.shopifyDiscountId) {
      try {
        const updateInput = {
          title,
          combinesWith: {
            orderDiscounts: combinesWithOrder,
            productDiscounts: combinesWithProduct,
            shippingDiscounts: combinesWithShipping,
          },
          metafields: [
            {
              namespace: "$app:bogo-discount",
              key: "function-configuration",
              type: "json",
              value: JSON.stringify(functionConfig),
            },
          ],
        };

        await admin.graphql(
          `#graphql
            mutation updateAutomaticDiscount($id: ID!, $automaticAppDiscount: DiscountAutomaticAppInput!) {
              discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) {
                automaticAppDiscount {
                  discountId
                  title
                }
                userErrors {
                  field
                  message
                }
              }
            }`,
          {
            variables: {
              id: offer.shopifyDiscountId,
              automaticAppDiscount: updateInput,
            },
          }
        );
      } catch (e) {
        console.error("Error updating automatic discount on Shopify:", e);
      }
    }

    const updated = await prisma.discountOffer.update({
      where: { id: offerId },
      data: {
        title,
        buyQuantity,
        getQuantity,
        appliesToAll,
        eligibleProductIds,
        sameProductOnly,
        combinesWithOrder,
        combinesWithProduct,
        combinesWithShipping,
      },
    });

    await syncStorefrontMetafield(admin, shop);

    return { success: true, message: "Offer updated successfully!" };
  }

  if (intent === "toggle_status") {
    const offerId = formData.get("offerId");
    const currentStatus = formData.get("currentStatus");
    const newStatus = currentStatus === "ACTIVE" ? "PAUSED" : "ACTIVE";

    const offer = await prisma.discountOffer.findUnique({
      where: { id: offerId },
    });

    if (offer?.shopifyDiscountId) {
      try {
        if (newStatus === "PAUSED") {
          await admin.graphql(
            `#graphql
              mutation deactivateDiscount($id: ID!) {
                discountAutomaticDeactivate(id: $id) {
                  userErrors {
                    field
                    message
                  }
                }
              }`,
            { variables: { id: offer.shopifyDiscountId } }
          );
        } else {
          await admin.graphql(
            `#graphql
              mutation activateDiscount($id: ID!) {
                discountAutomaticActivate(id: $id) {
                  userErrors {
                    field
                    message
                  }
                }
              }`,
            { variables: { id: offer.shopifyDiscountId } }
          );
        }
      } catch (e) {
        console.warn("Could not toggle discount in Shopify:", e);
      }
    }

    await prisma.discountOffer.update({
      where: { id: offerId },
      data: { status: newStatus },
    });

    await syncStorefrontMetafield(admin, shop);

    return { success: true, message: `Offer ${newStatus.toLowerCase()}!` };
  }

  if (intent === "delete") {
    const offerId = formData.get("offerId");
    const offer = await prisma.discountOffer.findUnique({
      where: { id: offerId },
    });

    if (offer?.shopifyDiscountId) {
      try {
        await admin.graphql(
          `#graphql
            mutation deleteDiscount($id: ID!) {
              discountAutomaticDelete(id: $id) {
                userErrors {
                  field
                  message
                }
              }
            }`,
          { variables: { id: offer.shopifyDiscountId } }
        );
      } catch (e) {
        console.warn("Could not delete discount from Shopify:", e);
      }
    }

    await prisma.discountOffer.delete({
      where: { id: offerId },
    });

    await syncStorefrontMetafield(admin, shop);

    return { success: true, message: "Offer deleted!" };
  }

  return { success: false };
};

export default function OffersPage() {
  const { offers, products } = useLoaderData();
  const fetcher = useFetcher();

  const [formMode, setFormMode] = useState("closed"); // "closed", "create", "edit"
  const [editingOfferId, setEditingOfferId] = useState(null);

  const [title, setTitle] = useState("Buy 2 Get 1 FREE");
  const [buyQuantity, setBuyQuantity] = useState(2);
  const [getQuantity, setGetQuantity] = useState(1);
  const [appliesToAll, setAppliesToAll] = useState(true);
  const [selectedProductIds, setSelectedProductIds] = useState([]);
  const [sameProductOnly, setSameProductOnly] = useState(false);
  const [combinesWithOrder, setCombinesWithOrder] = useState(true);
  const [combinesWithProduct, setCombinesWithProduct] = useState(true);
  const [combinesWithShipping, setCombinesWithShipping] = useState(true);

  const isSubmitting =
    fetcher.state === "submitting" || fetcher.state === "loading";

  const openCreateForm = () => {
    setTitle("Buy 2 Get 1 FREE");
    setBuyQuantity(2);
    setGetQuantity(1);
    setAppliesToAll(true);
    setSelectedProductIds([]);
    setSameProductOnly(false);
    setCombinesWithOrder(true);
    setCombinesWithProduct(true);
    setCombinesWithShipping(true);
    setEditingOfferId(null);
    setFormMode("create");
  };

  const openEditForm = (offer) => {
    setTitle(offer.title);
    setBuyQuantity(offer.buyQuantity);
    setGetQuantity(offer.getQuantity);
    setAppliesToAll(offer.appliesToAll);
    try {
      setSelectedProductIds(JSON.parse(offer.eligibleProductIds || "[]"));
    } catch (e) {
      setSelectedProductIds([]);
    }
    setSameProductOnly(offer.sameProductOnly);
    setCombinesWithOrder(offer.combinesWithOrder);
    setCombinesWithProduct(offer.combinesWithProduct);
    setCombinesWithShipping(offer.combinesWithShipping);
    setEditingOfferId(offer.id);
    setFormMode("edit");
  };

  const closeForm = () => {
    setFormMode("closed");
    setEditingOfferId(null);
  };

  const handleProductToggle = (productId) => {
    if (selectedProductIds.includes(productId)) {
      setSelectedProductIds(selectedProductIds.filter((id) => id !== productId));
    } else {
      setSelectedProductIds([...selectedProductIds, productId]);
    }
  };

  return (
    <s-page heading="Buy X Get Y Free (BOGO Offers)">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => (formMode === "closed" ? openCreateForm() : closeForm())}
      >
        {formMode === "closed" ? "+ Create New Offer" : "Cancel"}
      </s-button>

      {/* Creation / Edit Form */}
      {formMode !== "closed" && (
        <s-section heading={formMode === "edit" ? "Edit Offer" : "Create Buy X Get Y Offer"}>
          <fetcher.Form
            method="post"
            onSubmit={closeForm}
            style={{
              background: "#ffffff",
              padding: "24px",
              borderRadius: "10px",
              border: "1px solid #cce1d8",
              display: "flex",
              flexDirection: "column",
              gap: "20px",
              marginBottom: "24px",
            }}
          >
            <input
              type="hidden"
              name="intent"
              value={formMode === "edit" ? "update" : "create"}
            />
            {formMode === "edit" && (
              <input type="hidden" name="offerId" value={editingOfferId} />
            )}
            <input
              type="hidden"
              name="eligibleProductIds"
              value={JSON.stringify(selectedProductIds)}
            />

            <div>
              <label
                htmlFor="offerTitle"
                style={{ display: "block", fontWeight: 600, marginBottom: "6px" }}
              >
                Offer Title (Seen by customers at checkout)
              </label>
              <input
                type="text"
                id="offerTitle"
                name="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid #ccc",
                  fontSize: "14px",
                }}
                required
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "16px",
              }}
            >
              <div>
                <label
                  htmlFor="buyQuantity"
                  style={{ display: "block", fontWeight: 600, marginBottom: "6px" }}
                >
                  Customer Buys (Quantity X)
                </label>
                <input
                  type="number"
                  id="buyQuantity"
                  name="buyQuantity"
                  min="1"
                  value={buyQuantity}
                  onChange={(e) => setBuyQuantity(parseInt(e.target.value, 10))}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid #ccc",
                    fontSize: "14px",
                  }}
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="getQuantity"
                  style={{ display: "block", fontWeight: 600, marginBottom: "6px" }}
                >
                  Customer Gets Free (Quantity Y)
                </label>
                <input
                  type="number"
                  id="getQuantity"
                  name="getQuantity"
                  min="1"
                  value={getQuantity}
                  onChange={(e) => setGetQuantity(parseInt(e.target.value, 10))}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid #ccc",
                    fontSize: "14px",
                  }}
                  required
                />
              </div>
            </div>

            <div
              style={{
                background: "#f0f7f4",
                padding: "12px 16px",
                borderRadius: "8px",
                fontSize: "13px",
                color: "#1c5436",
              }}
            >
              ✨ <strong>Offer Rule:</strong> When customer adds {buyQuantity + getQuantity} eligible items, the {getQuantity} cheapest {getQuantity > 1 ? "items are" : "item is"} <strong>100% FREE</strong>!
            </div>

            <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "4px 0" }} />

            {/* Scope / Products */}
            <div>
              <div style={{ fontWeight: 600, marginBottom: "8px" }}>
                Eligible Products
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="appliesToAll"
                    value="true"
                    checked={appliesToAll}
                    onChange={() => setAppliesToAll(true)}
                  />
                  <span>All Products in Store</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="appliesToAll"
                    value="false"
                    checked={!appliesToAll}
                    onChange={() => setAppliesToAll(false)}
                  />
                  <span>Specific Products Only</span>
                </label>
              </div>

              {!appliesToAll && (
                <div
                  style={{
                    marginTop: "12px",
                    maxHeight: "160px",
                    overflowY: "auto",
                    border: "1px solid #e1e3e5",
                    borderRadius: "6px",
                    padding: "8px 12px",
                  }}
                >
                  {products.map((p) => (
                    <label
                      key={p.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "6px 0",
                        cursor: "pointer",
                        borderBottom: "1px solid #f4f6f8",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedProductIds.includes(p.id)}
                        onChange={() => handleProductToggle(p.id)}
                      />
                      <span>{p.title}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  name="sameProductOnly"
                  value="true"
                  checked={sameProductOnly}
                  onChange={(e) => setSameProductOnly(e.target.checked)}
                />
                <span style={{ fontSize: "14px" }}>
                  Only apply if buying multiple units of the <strong>exact same product</strong> (e.g. 4 of Product A, rather than mixing A + B)
                </span>
              </label>
            </div>

            <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "4px 0" }} />

            <div>
              <div style={{ fontWeight: 600, marginBottom: "8px" }}>
                Discount Combinations
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    name="combinesWithProduct"
                    value="true"
                    checked={combinesWithProduct}
                    onChange={(e) => setCombinesWithProduct(e.target.checked)}
                  />
                  <span>Can combine with other Product Discounts</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    name="combinesWithOrder"
                    value="true"
                    checked={combinesWithOrder}
                    onChange={(e) => setCombinesWithOrder(e.target.checked)}
                  />
                  <span>Can combine with Order Discounts</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    name="combinesWithShipping"
                    value="true"
                    checked={combinesWithShipping}
                    onChange={(e) => setCombinesWithShipping(e.target.checked)}
                  />
                  <span>Can combine with Shipping Discounts</span>
                </label>
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
              <s-button type="submit" variant="primary" loading={isSubmitting ? "true" : undefined}>
                {formMode === "edit" ? "Save Changes" : "Create & Activate Offer"}
              </s-button>
              <s-button type="button" onClick={closeForm}>
                Cancel
              </s-button>
            </div>
          </fetcher.Form>
        </s-section>
      )}

      {/* Offers Table */}
      <s-section heading="Active & Created Offers">
        {offers.length === 0 ? (
          <div
            style={{
              padding: "40px",
              textAlign: "center",
              background: "#ffffff",
              borderRadius: "10px",
              border: "1px dashed #c9cccf",
            }}
          >
            <div style={{ fontSize: "16px", fontWeight: 600, marginBottom: "6px" }}>
              No BOGO offers created yet
            </div>
            <div style={{ fontSize: "14px", color: "#616161", marginBottom: "16px" }}>
              Create your first Buy X Get Y Free offer to boost order volume.
            </div>
            <s-button variant="primary" onClick={openCreateForm}>
              + Create Buy 2 Get 1 Free Offer
            </s-button>
          </div>
        ) : (
          <div
            style={{
              background: "#ffffff",
              borderRadius: "10px",
              border: "1px solid #e1e3e5",
              overflow: "hidden",
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "14px",
              }}
            >
              <thead>
                <tr style={{ background: "#f7fafc", borderBottom: "1px solid #e2e8f0", textAlign: "left" }}>
                  <th style={{ padding: "12px 16px" }}>Offer Title</th>
                  <th style={{ padding: "12px 16px" }}>Rule</th>
                  <th style={{ padding: "12px 16px" }}>Scope</th>
                  <th style={{ padding: "12px 16px" }}>Status</th>
                  <th style={{ padding: "12px 16px", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {offers.map((offer) => (
                  <tr
                    key={offer.id}
                    style={{
                      borderBottom: "1px solid #edf2f7",
                    }}
                  >
                    <td style={{ padding: "14px 16px", fontWeight: 600 }}>
                      {offer.title}
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      Buy {offer.buyQuantity}, Get {offer.getQuantity} Free (Cheapest item free)
                    </td>
                    <td style={{ padding: "14px 16px", color: "#4a5568" }}>
                      {offer.appliesToAll ? "All Products" : "Selected Products"}
                      {offer.sameProductOnly ? " (Same Product Only)" : ""}
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <span
                        style={{
                          padding: "3px 8px",
                          borderRadius: "9999px",
                          fontSize: "12px",
                          fontWeight: 600,
                          backgroundColor:
                            offer.status === "ACTIVE" ? "#e3fcef" : "#fff0b3",
                          color:
                            offer.status === "ACTIVE" ? "#006644" : "#172b4d",
                        }}
                      >
                        {offer.status}
                      </span>
                    </td>
                    <td style={{ padding: "14px 16px", textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: "8px" }}>
                        <button
                          type="button"
                          onClick={() => openEditForm(offer)}
                          style={{
                            padding: "4px 10px",
                            fontSize: "12px",
                            borderRadius: "4px",
                            border: "1px solid #b3d4fc",
                            background: "#f0f7ff",
                            color: "#0052cc",
                            cursor: "pointer",
                            fontWeight: 500,
                          }}
                        >
                          Edit
                        </button>

                        <fetcher.Form method="post">
                          <input type="hidden" name="intent" value="toggle_status" />
                          <input type="hidden" name="offerId" value={offer.id} />
                          <input
                            type="hidden"
                            name="currentStatus"
                            value={offer.status}
                          />
                          <button
                            type="submit"
                            style={{
                              padding: "4px 10px",
                              fontSize: "12px",
                              borderRadius: "4px",
                              border: "1px solid #ccc",
                              background: "#fff",
                              cursor: "pointer",
                            }}
                          >
                            {offer.status === "ACTIVE" ? "Pause" : "Resume"}
                          </button>
                        </fetcher.Form>

                        <fetcher.Form method="post">
                          <input type="hidden" name="intent" value="delete" />
                          <input type="hidden" name="offerId" value={offer.id} />
                          <button
                            type="submit"
                            onClick={(e) => {
                              if (!confirm("Are you sure you want to delete this offer?")) {
                                e.preventDefault();
                              }
                            }}
                            style={{
                              padding: "4px 10px",
                              fontSize: "12px",
                              borderRadius: "4px",
                              border: "1px solid #ffccd1",
                              background: "#fff5f5",
                              color: "#d72c0d",
                              cursor: "pointer",
                            }}
                          >
                            Delete
                          </button>
                        </fetcher.Form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error();
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
