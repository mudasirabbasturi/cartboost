<?php
/**
 * CartBoost - Core PHP Configuration & Shopify Helper Functions
 * Pure PHP (zero external dependencies required)
 */

declare(strict_types=1);

// Enable error reporting during setup (can be turned off in production)
ini_set('display_errors', '0');
error_reporting(E_ALL);

// ==========================================
// 1. DATABASE CONFIGURATION (MySQL / cPanel)
// ==========================================
// Update these with your GoDaddy cPanel MySQL details
define('DB_HOST', 'localhost');
define('DB_NAME', 'cartboost_db');      // e.g. cpaneluser_cartboost
define('DB_USER', 'cartboost_user');    // e.g. cpaneluser_dbuser
define('DB_PASS', 'YOUR_DB_PASSWORD');
define('DB_CHARSET', 'utf8mb4');

// ==========================================
// 2. SHOPIFY APP CREDENTIALS
// ==========================================
define('SHOPIFY_API_KEY', '38b390284d1199e6cfc3cb637d8e1c44');
define('SHOPIFY_API_SECRET', 'YOUR_SHOPIFY_CLIENT_SECRET'); // Copy from Shopify Partner Dashboard -> App setup
define('SHOPIFY_SCOPES', 'write_products,write_metaobjects,write_metaobject_definitions,write_discounts');
define('SHOPIFY_API_VERSION', '2025-01');

// Base URL of where you upload this folder on your GoDaddy domain (NO trailing slash)
// e.g. https://cartboost.yourdomain.com or https://yourdomain.com/cartboost
define('APP_URL', 'https://YOUR_DOMAIN_OR_SUBDOMAIN.com');

/**
 * Returns a shared PDO database connection instance.
 */
function get_db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=" . DB_CHARSET;
        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ];
        try {
            $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
        } catch (PDOException $e) {
            die("Database connection failed. Please verify DB credentials in config.php: " . htmlspecialchars($e->getMessage()));
        }
    }
    return $pdo;
}

/**
 * Executes a GraphQL request to Shopify Admin API using native cURL.
 */
function shopify_graphql(string $shop, string $accessToken, string $query, array $variables = []): array {
    $endpoint = "https://{$shop}/admin/api/" . SHOPIFY_API_VERSION . "/graphql.json";
    
    $payload = json_encode([
        'query' => $query,
        'variables' => $variables
    ]);

    $ch = curl_init($endpoint);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'X-Shopify-Access-Token: ' . $accessToken,
        'User-Agent: CartBoost-PHP/1.0'
    ]);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);

    $response = curl_exec($ch);
    $error = curl_error($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($error) {
        return ['error' => 'cURL Error: ' . $error];
    }

    $decoded = json_decode($response, true);
    return is_array($decoded) ? $decoded : ['error' => 'Invalid JSON response', 'raw' => $response, 'status' => $httpCode];
}

/**
 * Syncs Free Shipping settings and all active BOGO offers to the Shopify shop-level metafield: $app:config
 */
function sync_storefront_metafield(PDO $pdo, string $shop, string $accessToken): bool {
    try {
        // 1. Get Shop ID
        $shopRes = shopify_graphql($shop, $accessToken, 'query { shop { id } }');
        $shopId = $shopRes['data']['shop']['id'] ?? null;
        if (!$shopId) {
            return false;
        }

        // 2. Query settings from MySQL
        $stmt = $pdo->prepare("SELECT * FROM settings WHERE shop = ?");
        $stmt->execute([$shop]);
        $settings = $stmt->fetch();

        // 3. Query all ACTIVE discount offers from MySQL
        $stmtOffers = $pdo->prepare("SELECT * FROM discount_offers WHERE shop = ? AND status = 'ACTIVE' ORDER BY id DESC");
        $stmtOffers->execute([$shop]);
        $offers = $stmtOffers->fetchAll();

        $formattedOffers = [];
        foreach ($offers as $offer) {
            $productIds = json_decode($offer['eligible_product_ids'] ?? '[]', true) ?: [];
            $formattedOffers[] = [
                'id' => (string)$offer['id'],
                'active' => true,
                'buyX' => (int)$offer['buy_quantity'],
                'getY' => (int)$offer['get_quantity'],
                'title' => $offer['title'],
                'appliesToAll' => (bool)$offer['applies_to_all'],
                'sameProductOnly' => (bool)$offer['same_product_only'],
                'eligibleProductIds' => $productIds
            ];
        }

        $configPayload = [
            'enabled' => $settings ? (bool)$settings['enabled'] : true,
            'threshold' => $settings ? (float)$settings['threshold_amount'] : 50.0,
            'message' => $settings['message'] ?? "You're {amount} away from FREE shipping!",
            'successMessage' => $settings['success_message'] ?? "Congratulations! You've unlocked FREE shipping!",
            'emptyMessage' => $settings['empty_message'] ?? "Free shipping on orders over {amount}!",
            'barColor' => $settings['bar_color'] ?? '#108043',
            'barBgColor' => $settings['bar_bg_color'] ?? '#e0e0e0',
            'textColor' => $settings['text_color'] ?? '#202223',
            'barHeight' => $settings ? (int)$settings['bar_height'] : 8,
            'barShape' => $settings['bar_shape'] ?? 'rounded',
            'bogoOffer' => $formattedOffers[0] ?? null,
            'bogoOffers' => $formattedOffers
        ];

        $mutation = <<<'GRAPHQL'
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
        }
GRAPHQL;

        $variables = [
            'metafields' => [
                [
                    'ownerId' => $shopId,
                    'namespace' => '$app',
                    'key' => 'config',
                    'type' => 'json',
                    'value' => json_encode($configPayload)
                ]
            ]
        ];

        $res = shopify_graphql($shop, $accessToken, $mutation, $variables);
        return empty($res['data']['metafieldsSet']['userErrors']);
    } catch (Exception $e) {
        error_log("[CartBoost PHP] Metafield sync error: " . $e->getMessage());
        return false;
    }
}

/**
 * Validates Shopify OAuth HMAC signature on GET requests.
 */
function verify_shopify_hmac(array $params, string $secret): bool {
    if (!isset($params['hmac'])) {
        return false;
    }
    $hmac = $params['hmac'];
    unset($params['hmac'], $params['signature']);
    ksort($params);

    $computedParts = [];
    foreach ($params as $key => $val) {
        $computedParts[] = "{$key}={$val}";
    }
    $queryString = implode('&', $computedParts);
    $calculatedHmac = hash_hmac('sha256', $queryString, $secret);

    return hash_equals($hmac, $calculatedHmac);
}

/**
 * Validates Shopify Webhook HMAC header (X-Shopify-Hmac-Sha256).
 */
function verify_shopify_webhook(string $data, string $hmacHeader, string $secret): bool {
    $calculated = base64_encode(hash_hmac('sha256', $data, $secret, true));
    return hash_equals($hmacHeader, $calculated);
}
