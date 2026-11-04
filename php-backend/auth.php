<?php
/**
 * CartBoost - Shopify OAuth Handler (Core PHP)
 * Handles App Installation & Token Exchange
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';

$pdo = get_db();
$params = $_GET;
$shop = isset($params['shop']) ? trim((string)$params['shop']) : '';

// Basic sanity check on shop domain
if ($shop === '' || !preg_match('/^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/', $shop)) {
    die("Error: Invalid or missing 'shop' query parameter.");
}

// -------------------------------------------------------------
// STEP 1: Redirect to Shopify OAuth Screen (Installation Start)
// -------------------------------------------------------------
if (!isset($params['code'])) {
    $state = bin2hex(random_bytes(16));
    
    // Store state in session or DB
    $stmt = $pdo->prepare("
        INSERT INTO sessions (id, shop, state, access_token) 
        VALUES (?, ?, ?, '') 
        ON DUPLICATE KEY UPDATE state = VALUES(state)
    ");
    $stmt->execute(["offline_{$shop}", $shop, $state]);

    $redirectUri = urlencode(APP_URL . '/auth.php');
    $installUrl = "https://{$shop}/admin/oauth/authorize?client_id=" . SHOPIFY_API_KEY . 
                  "&scope=" . urlencode(SHOPIFY_SCOPES) . 
                  "&redirect_uri={$redirectUri}&state={$state}";

    header("Location: {$installUrl}");
    exit;
}

// -------------------------------------------------------------
// STEP 2: OAuth Callback (Shopify redirects back with code)
// -------------------------------------------------------------
if (!verify_shopify_hmac($params, SHOPIFY_API_SECRET)) {
    die("Security verification failed: HMAC mismatch.");
}

$code = $params['code'];
$state = $params['state'] ?? '';

// Verify state matches our stored state
$stmt = $pdo->prepare("SELECT state FROM sessions WHERE id = ?");
$stmt->execute(["offline_{$shop}"]);
$existing = $stmt->fetch();

if (!$existing || $existing['state'] !== $state) {
    die("Security error: State parameter mismatch or expired session.");
}

// Exchange code for permanent access_token
$tokenEndpoint = "https://{$shop}/admin/oauth/access_token";
$ch = curl_init($tokenEndpoint);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
    'client_id' => SHOPIFY_API_KEY,
    'client_secret' => SHOPIFY_API_SECRET,
    'code' => $code
]));
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'Accept: application/json'
]);
curl_setopt($ch, CURLOPT_TIMEOUT, 15);
$response = curl_exec($ch);
curl_close($ch);

$tokenData = json_decode((string)$response, true);
if (empty($tokenData['access_token'])) {
    die("Failed to obtain access token from Shopify: " . htmlspecialchars($response ?: 'Unknown error'));
}

$accessToken = (string)$tokenData['access_token'];
$scope = (string)($tokenData['scope'] ?? SHOPIFY_SCOPES);

// Save access token to MySQL
$stmt = $pdo->prepare("
    INSERT INTO sessions (id, shop, state, scope, access_token) 
    VALUES (?, ?, ?, ?, ?) 
    ON DUPLICATE KEY UPDATE 
        access_token = VALUES(access_token),
        scope = VALUES(scope),
        state = VALUES(state)
");
$stmt->execute(["offline_{$shop}", $shop, $state, $scope, $accessToken]);

// Ensure default settings record exists in MySQL
$stmt = $pdo->prepare("
    INSERT IGNORE INTO settings (shop, enabled, threshold_amount, message, success_message, empty_message, bar_color, bar_bg_color, text_color, bar_height, bar_shape)
    VALUES (?, 1, 50.00, 'You\'re {amount} away from FREE shipping!', 'Congratulations! You\'ve unlocked FREE shipping!', 'Free shipping on orders over {amount}!', '#108043', '#e0e0e0', '#202223', 8, 'rounded')
");
$stmt->execute([$shop]);

// Initial storefront metafield sync
sync_storefront_metafield($pdo, $shop, $accessToken);

// Redirect to App Admin Dashboard
$host = isset($params['host']) ? urlencode($params['host']) : '';
header("Location: " . APP_URL . "/index.php?shop={$shop}&host={$host}");
exit;
