<?php
/**
 * CartBoost - BOGO Discount Offers Manager (Pure PHP)
 * Create, Edit, Pause, Resume, and Delete Buy X Get Y Free Offers
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';

$pdo = get_db();
$shop = isset($_GET['shop']) ? trim((string)$_GET['shop']) : '';
$host = isset($_GET['host']) ? trim((string)$_GET['host']) : '';

if ($shop === '') {
    die("Error: Missing 'shop' parameter.");
}

// Verify active session
$stmt = $pdo->prepare("SELECT * FROM sessions WHERE shop = ? AND access_token != '' LIMIT 1");
$stmt->execute([$shop]);
$session = $stmt->fetch();

if (!$session) {
    header("Location: " . APP_URL . "/auth.php?shop=" . urlencode($shop));
    exit;
}

$accessToken = $session['access_token'];
$successMessage = '';
$errorMessage = '';

// -------------------------------------------------------------
// Helper: Find bogo-discount Shopify Function ID
// -------------------------------------------------------------
function get_bogo_function_id(string $shop, string $accessToken): ?string {
    $query = <<<'GRAPHQL'
    query getFunctions {
      shopifyFunctions(first: 25) {
        nodes {
          id
          title
          apiType
        }
      }
    }
GRAPHQL;

    $res = shopify_graphql($shop, $accessToken, $query);
    $nodes = $res['data']['shopifyFunctions']['nodes'] ?? [];
    foreach ($nodes as $node) {
        if ($node['title'] === 'bogo-discount' || $node['apiType'] === 'product_discounts') {
            return $node['id'];
        }
    }
    return null;
}

// -------------------------------------------------------------
// POST ACTIONS (Create, Edit, Pause/Resume, Delete)
// -------------------------------------------------------------
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';

    if ($action === 'create') {
        $title = trim((string)($_POST['title'] ?? 'Buy 2 Get 1 FREE'));
        $buyQty = max(1, (int)($_POST['buy_quantity'] ?? 2));
        $getQty = max(1, (int)($_POST['get_quantity'] ?? 1));
        $appliesToAll = isset($_POST['applies_to_all']) && $_POST['applies_to_all'] === '1' ? 1 : 0;
        $sameProductOnly = isset($_POST['same_product_only']) ? 1 : 0;
        $productIds = isset($_POST['product_ids']) && is_array($_POST['product_ids']) ? $_POST['product_ids'] : [];
        $productIdsJson = json_encode($productIds);

        // 1. Create discount on Shopify using GraphQL mutation
        $functionId = get_bogo_function_id($shop, $accessToken);
        $functionConfig = [
            'buyQuantity' => $buyQty,
            'getQuantity' => $getQty,
            'discountPercentage' => 100,
            'appliesToAll' => (bool)$appliesToAll,
            'eligibleProductIds' => $productIds,
            'sameProductOnly' => (bool)$sameProductOnly,
            'title' => $title
        ];

        $discountInput = [
            'title' => $title,
            'startsAt' => gmdate('Y-m-d\TH:i:s\Z'),
            'combinesWith' => [
                'orderDiscounts' => true,
                'productDiscounts' => true,
                'shippingDiscounts' => true
            ],
            'metafields' => [
                [
                    'namespace' => '$app:bogo-discount',
                    'key' => 'function-configuration',
                    'type' => 'json',
                    'value' => json_encode($functionConfig)
                ]
            ]
        ];

        if ($functionId) {
            $discountInput['functionId'] = $functionId;
        } else {
            $discountInput['functionHandle'] = 'bogo-discount';
        }

        $createMutation = <<<'GRAPHQL'
        mutation createDiscount($automaticAppDiscount: DiscountAutomaticAppInput!) {
          discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
            automaticAppDiscount {
              discountId
              title
            }
            userErrors {
              field
              message
            }
          }
        }
GRAPHQL;

        $res = shopify_graphql($shop, $accessToken, $createMutation, ['automaticAppDiscount' => $discountInput]);
        $shopifyDiscountId = $res['data']['discountAutomaticAppCreate']['automaticAppDiscount']['discountId'] ?? null;

        // 2. Save in MySQL
        $stmt = $pdo->prepare("
            INSERT INTO discount_offers (shop, shopify_discount_id, title, buy_quantity, get_quantity, discount_percentage, applies_to_all, eligible_product_ids, same_product_only, status)
            VALUES (?, ?, ?, ?, ?, 100.00, ?, ?, ?, 'ACTIVE')
        ");
        $stmt->execute([$shop, $shopifyDiscountId, $title, $buyQty, $getQty, $appliesToAll, $productIdsJson, $sameProductOnly]);

        // 3. Sync storefront metafield
        sync_storefront_metafield($pdo, $shop, $accessToken);
        $successMessage = "Offer created and activated successfully!";
    }

    if ($action === 'toggle_status') {
        $offerId = (int)$_POST['offer_id'];
        $stmt = $pdo->prepare("SELECT * FROM discount_offers WHERE id = ? AND shop = ?");
        $stmt->execute([$offerId, $shop]);
        $offer = $stmt->fetch();

        if ($offer) {
            $newStatus = $offer['status'] === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
            
            // Toggle in Shopify
            if (!empty($offer['shopify_discount_id'])) {
                $toggleMutation = $newStatus === 'PAUSED' ?
                    'mutation deactivate($id: ID!) { discountAutomaticDeactivate(id: $id) { userErrors { message } } }' :
                    'mutation activate($id: ID!) { discountAutomaticActivate(id: $id) { userErrors { message } } }';
                shopify_graphql($shop, $accessToken, $toggleMutation, ['id' => $offer['shopify_discount_id']]);
            }

            // Update in MySQL
            $stmt = $pdo->prepare("UPDATE discount_offers SET status = ? WHERE id = ?");
            $stmt->execute([$newStatus, $offerId]);

            sync_storefront_metafield($pdo, $shop, $accessToken);
            $successMessage = "Offer {$newStatus}!";
        }
    }

    if ($action === 'delete') {
        $offerId = (int)$_POST['offer_id'];
        $stmt = $pdo->prepare("SELECT * FROM discount_offers WHERE id = ? AND shop = ?");
        $stmt->execute([$offerId, $shop]);
        $offer = $stmt->fetch();

        if ($offer) {
            if (!empty($offer['shopify_discount_id'])) {
                $deleteMutation = 'mutation deleteDiscount($id: ID!) { discountAutomaticDelete(id: $id) { userErrors { message } } }';
                shopify_graphql($shop, $accessToken, $deleteMutation, ['id' => $offer['shopify_discount_id']]);
            }

            $stmt = $pdo->prepare("DELETE FROM discount_offers WHERE id = ?");
            $stmt->execute([$offerId]);

            sync_storefront_metafield($pdo, $shop, $accessToken);
            $successMessage = "Offer deleted successfully!";
        }
    }
}

// -------------------------------------------------------------
// Fetch products for product-specific offers
// -------------------------------------------------------------
$products = [];
try {
    $pRes = shopify_graphql($shop, $accessToken, 'query { products(first: 25) { nodes { id title } } }');
    $products = $pRes['data']['products']['nodes'] ?? [];
} catch (Exception $e) {}

// Fetch active offers from MySQL
$stmt = $pdo->prepare("SELECT * FROM discount_offers WHERE shop = ? ORDER BY id DESC");
$stmt->execute([$shop]);
$offers = $stmt->fetchAll();
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CartBoost - Buy X Get Y Free</title>
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
  <style>
    :root {
      --p-color-bg-surface: #ffffff;
      --p-color-border: #e2e8f0;
      --p-color-text: #202223;
      --p-color-primary: #008060;
      --p-color-primary-hover: #006e52;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #f1f2f4;
      color: var(--p-color-text);
      margin: 0;
      padding: 24px;
      line-height: 1.5;
    }
    .cb-container { max-width: 960px; margin: 0 auto; }
    .cb-nav {
      display: flex; gap: 12px; margin-bottom: 24px; background: #ffffff;
      padding: 10px 16px; border-radius: 10px; border: 1px solid var(--p-color-border);
    }
    .cb-nav-link {
      padding: 8px 16px; border-radius: 6px; font-weight: 600; font-size: 14px;
      text-decoration: none; color: #5c5f62;
    }
    .cb-nav-link.active { background: #e8f5e9; color: var(--p-color-primary); }
    .cb-card {
      background: #ffffff; border-radius: 12px; border: 1px solid var(--p-color-border);
      padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .cb-card-title { font-size: 18px; font-weight: 700; margin-top: 0; margin-bottom: 16px; }
    .cb-input {
      width: 100%; padding: 9px 12px; border: 1px solid #c9cccf; border-radius: 6px; font-size: 14px;
    }
    .cb-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .cb-form-group { margin-bottom: 16px; }
    .cb-form-group label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
    .cb-btn {
      background: var(--p-color-primary); color: #ffffff; border: none; padding: 10px 20px;
      border-radius: 6px; font-weight: 600; font-size: 14px; cursor: pointer;
    }
    .cb-btn:hover { background: var(--p-color-primary-hover); }
    .cb-btn-secondary {
      background: #f4f6f8; color: #202223; border: 1px solid #c9cccf; padding: 6px 12px;
      border-radius: 4px; font-size: 12px; cursor: pointer; font-weight: 600;
    }
    .cb-btn-danger {
      background: #ffebe6; color: #de350b; border: 1px solid #ffbdad; padding: 6px 12px;
      border-radius: 4px; font-size: 12px; cursor: pointer; font-weight: 600;
    }
    .cb-table { width: 100%; border-collapse: collapse; font-size: 14px; }
    .cb-table th { background: #f7fafc; padding: 12px 16px; text-align: left; border-bottom: 1px solid #e2e8f0; }
    .cb-table td { padding: 14px 16px; border-bottom: 1px solid #edf2f7; }
    .cb-badge {
      display: inline-block; padding: 3px 8px; border-radius: 9999px; font-size: 12px; font-weight: 700;
    }
    .cb-badge-active { background: #e3fcef; color: #006644; }
    .cb-badge-paused { background: #fff0b3; color: #172b4d; }
    .cb-alert { padding: 12px 16px; border-radius: 8px; font-size: 14px; margin-bottom: 20px; }
    .cb-alert-success { background: #e3fcef; color: #006644; border: 1px solid #abf5d1; }
  </style>
</head>
<body>
  <div class="cb-container">

    <!-- Top Navigation -->
    <nav class="cb-nav">
      <a href="index.php?shop=<?= urlencode($shop) ?>&host=<?= urlencode($host) ?>" class="cb-nav-link">🚚 Shipping Bar</a>
      <a href="offers.php?shop=<?= urlencode($shop) ?>&host=<?= urlencode($host) ?>" class="cb-nav-link active">🎁 Buy X Get Y (BOGO)</a>
    </nav>

    <?php if ($successMessage): ?>
      <div class="cb-alert cb-alert-success"><?= htmlspecialchars($successMessage) ?></div>
    <?php endif; ?>

    <!-- Create Offer Card -->
    <div class="cb-card">
      <h2 class="cb-card-title">+ Create Buy X Get Y Free Offer</h2>
      <form method="POST">
        <input type="hidden" name="action" value="create">

        <div class="cb-form-group">
          <label for="title">Offer Title (Visible to shoppers)</label>
          <input type="text" id="title" name="title" class="cb-input" value="Buy 2 Get 1 FREE" required>
        </div>

        <div class="cb-grid-2">
          <div class="cb-form-group">
            <label for="buy_quantity">Customer Buys (Quantity X)</label>
            <input type="number" min="1" id="buy_quantity" name="buy_quantity" class="cb-input" value="2" required>
          </div>
          <div class="cb-form-group">
            <label for="get_quantity">Customer Gets Free (Quantity Y)</label>
            <input type="number" min="1" id="get_quantity" name="get_quantity" class="cb-input" value="1" required>
          </div>
        </div>

        <div class="cb-form-group">
          <label style="font-weight: 600; margin-bottom: 8px;">Eligible Products</label>
          <div style="display: flex; gap: 16px; margin-bottom: 8px;">
            <label><input type="radio" name="applies_to_all" value="1" checked onclick="document.getElementById('productPicker').style.display='none'"> All Products</label>
            <label><input type="radio" name="applies_to_all" value="0" onclick="document.getElementById('productPicker').style.display='block'"> Specific Products</label>
          </div>

          <div id="productPicker" style="display: none; max-height: 140px; overflow-y: auto; border: 1px solid #ccc; padding: 10px; border-radius: 6px;">
            <?php foreach ($products as $p): ?>
              <label style="display: block; margin-bottom: 6px; cursor: pointer;">
                <input type="checkbox" name="product_ids[]" value="<?= htmlspecialchars($p['id']) ?>">
                <?= htmlspecialchars($p['title']) ?>
              </label>
            <?php endforeach; ?>
          </div>
        </div>

        <div class="cb-form-group">
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
            <input type="checkbox" name="same_product_only" value="1">
            <span>Only apply when buying multiple units of the <strong>exact same product</strong></span>
          </label>
        </div>

        <button type="submit" class="cb-btn">Create & Activate Offer</button>
      </form>
    </div>

    <!-- Active Offers List Card -->
    <div class="cb-card">
      <h2 class="cb-card-title">Created BOGO Offers</h2>
      <?php if (empty($offers)): ?>
        <p style="color: #616161;">No offers created yet. Create your first offer above!</p>
      <?php else: ?>
        <table class="cb-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Rule</th>
              <th>Scope</th>
              <th>Status</th>
              <th style="text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            <?php foreach ($offers as $off): ?>
              <tr>
                <td style="font-weight: 600;"><?= htmlspecialchars($off['title']) ?></td>
                <td>Buy <?= (int)$off['buy_quantity'] ?>, Get <?= (int)$off['get_quantity'] ?> Free</td>
                <td><?= $off['applies_to_all'] ? 'All Products' : 'Selected Products' ?></td>
                <td>
                  <span class="cb-badge <?= $off['status'] === 'ACTIVE' ? 'cb-badge-active' : 'cb-badge-paused' ?>">
                    <?= htmlspecialchars($off['status']) ?>
                  </span>
                </td>
                <td style="text-align: right;">
                  <form method="POST" style="display: inline-block;">
                    <input type="hidden" name="action" value="toggle_status">
                    <input type="hidden" name="offer_id" value="<?= (int)$off['id'] ?>">
                    <button type="submit" class="cb-btn-secondary">
                      <?= $off['status'] === 'ACTIVE' ? 'Pause' : 'Resume' ?>
                    </button>
                  </form>
                  <form method="POST" style="display: inline-block; margin-left: 6px;" onsubmit="return confirm('Are you sure you want to delete this offer?');">
                    <input type="hidden" name="action" value="delete">
                    <input type="hidden" name="offer_id" value="<?= (int)$off['id'] ?>">
                    <button type="submit" class="cb-btn-danger">Delete</button>
                  </form>
                </td>
              </tr>
            <?php endforeach; ?>
          </tbody>
        </table>
      <?php endif; ?>
    </div>

  </div>
</body>
</html>

