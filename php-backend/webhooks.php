<?php
/**
 * CartBoost - Shopify Webhooks & GDPR Compliance Handler (Pure PHP)
 * Responds to mandatory compliance topics: customers/data_request, customers/redact, shop/redact, app/uninstalled
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';

// Read raw body and Shopify headers
$data = (string)file_get_contents('php://input');
$hmacHeader = $_SERVER['HTTP_X_SHOPIFY_HMAC_SHA256'] ?? '';
$topic = $_SERVER['HTTP_X_SHOPIFY_TOPIC'] ?? '';
$shop = $_SERVER['HTTP_X_SHOPIFY_SHOP_DOMAIN'] ?? '';

// 1. Verify HMAC Signature
if (!verify_shopify_webhook($data, $hmacHeader, SHOPIFY_API_SECRET)) {
    http_response_code(401);
    die('Unauthorized: Webhook HMAC verification failed');
}

$payload = json_decode($data, true) ?: [];
$pdo = get_db();

// 2. Route by Webhook Topic
switch ($topic) {
    case 'customers/data_request':
        // CartBoost does not store customer personal identifiable information (PII).
        // Return 200 OK to acknowledge compliance request.
        http_response_code(200);
        echo json_encode(['status' => 'success', 'message' => 'No customer PII stored']);
        break;

    case 'customers/redact':
        // CartBoost does not store customer profiles or customer personal data.
        http_response_code(200);
        echo json_encode(['status' => 'success', 'message' => 'Customer redacted']);
        break;

    case 'shop/redact':
        // Shop data erasure (48 hours after uninstall).
        // Purge all shop records from MySQL to comply with GDPR:
        if ($shop !== '') {
            try {
                $stmt = $pdo->prepare("DELETE FROM discount_offers WHERE shop = ?");
                $stmt->execute([$shop]);

                $stmt = $pdo->prepare("DELETE FROM settings WHERE shop = ?");
                $stmt->execute([$shop]);

                $stmt = $pdo->prepare("DELETE FROM sessions WHERE shop = ?");
                $stmt->execute([$shop]);

                error_log("[CartBoost PHP] Successfully purged all store data on shop/redact for {$shop}");
            } catch (Exception $e) {
                error_log("[CartBoost PHP] Error during shop/redact: " . $e->getMessage());
            }
        }
        http_response_code(200);
        echo json_encode(['status' => 'success']);
        break;

    case 'app/uninstalled':
        // App was uninstalled from store: delete active session
        if ($shop !== '') {
            try {
                $stmt = $pdo->prepare("DELETE FROM sessions WHERE shop = ?");
                $stmt->execute([$shop]);
            } catch (Exception $e) {
                error_log("[CartBoost PHP] Error on app/uninstalled: " . $e->getMessage());
            }
        }
        http_response_code(200);
        echo json_encode(['status' => 'success']);
        break;

    default:
        // Acknowledge any other registered webhooks
        http_response_code(200);
        echo json_encode(['status' => 'received']);
        break;
}
exit;

