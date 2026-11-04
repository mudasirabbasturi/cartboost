<?php
/**
 * CartBoost - Merchant Admin Dashboard (Pure PHP)
 * Free Shipping Progress Bar Configuration & Live Preview
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';

$pdo = get_db();
$shop = isset($_GET['shop']) ? trim((string)$_GET['shop']) : '';
$host = isset($_GET['host']) ? trim((string)$_GET['host']) : '';

if ($shop === '') {
    die("Error: Missing 'shop' parameter. Please open this app from your Shopify Admin.");
}

// 1. Verify that this store has an active session in MySQL
$stmt = $pdo->prepare("SELECT * FROM sessions WHERE shop = ? AND access_token != '' LIMIT 1");
$stmt->execute([$shop]);
$session = $stmt->fetch();

if (!$session) {
    // If not authenticated yet, redirect to OAuth flow
    header("Location: " . APP_URL . "/auth.php?shop=" . urlencode($shop));
    exit;
}

$accessToken = $session['access_token'];
$successMessage = '';
$errorMessage = '';

// 2. Handle Settings Form Submission (POST)
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $enabled = isset($_POST['enabled']) ? 1 : 0;
    $threshold = (float)($_POST['threshold_amount'] ?? 50.0);
    $message = trim((string)($_POST['message'] ?? "You're {amount} away from FREE shipping!"));
    $successMsg = trim((string)($_POST['success_message'] ?? "Congratulations! You've unlocked FREE shipping!"));
    $emptyMsg = trim((string)($_POST['empty_message'] ?? "Free shipping on orders over {amount}!"));
    $barColor = trim((string)($_POST['bar_color'] ?? '#108043'));
    $barBgColor = trim((string)($_POST['bar_bg_color'] ?? '#e0e0e0'));
    $textColor = trim((string)($_POST['text_color'] ?? '#202223'));
    $barHeight = (int)($_POST['bar_height'] ?? 8);
    $barShape = in_array($_POST['bar_shape'] ?? '', ['rounded', 'square'], true) ? $_POST['bar_shape'] : 'rounded';

    try {
        $stmtUpdate = $pdo->prepare("
            INSERT INTO settings (shop, enabled, threshold_amount, message, success_message, empty_message, bar_color, bar_bg_color, text_color, bar_height, bar_shape)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                enabled = VALUES(enabled),
                threshold_amount = VALUES(threshold_amount),
                message = VALUES(message),
                success_message = VALUES(success_message),
                empty_message = VALUES(empty_message),
                bar_color = VALUES(bar_color),
                bar_bg_color = VALUES(bar_bg_color),
                text_color = VALUES(text_color),
                bar_height = VALUES(bar_height),
                bar_shape = VALUES(bar_shape)
        ");
        $stmtUpdate->execute([
            $shop, $enabled, $threshold, $message, $successMsg, $emptyMsg, $barColor, $barBgColor, $textColor, $barHeight, $barShape
        ]);

        // Sync with Shopify Metafield immediately
        $synced = sync_storefront_metafield($pdo, $shop, $accessToken);
        $successMessage = "Settings saved & synced to storefront successfully!";
    } catch (Exception $e) {
        $errorMessage = "Error saving settings: " . $e->getMessage();
    }
}

// 3. Load Current Settings from MySQL
$stmt = $pdo->prepare("SELECT * FROM settings WHERE shop = ? LIMIT 1");
$stmt->execute([$shop]);
$settings = $stmt->fetch() ?: [
    'enabled' => 1,
    'threshold_amount' => 50.00,
    'message' => "You're {amount} away from FREE shipping!",
    'success_message' => "Congratulations! You've unlocked FREE shipping!",
    'empty_message' => "Free shipping on orders over {amount}!",
    'bar_color' => '#108043',
    'bar_bg_color' => '#e0e0e0',
    'text_color' => '#202223',
    'bar_height' => 8,
    'bar_shape' => 'rounded',
];
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CartBoost - Free Shipping Bar</title>
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
  <style>
    :root {
      --p-color-bg-surface: #ffffff;
      --p-color-bg-surface-secondary: #f7fafc;
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
    .cb-container {
      max-width: 960px;
      margin: 0 auto;
    }
    /* Navigation Bar */
    .cb-nav {
      display: flex;
      gap: 12px;
      margin-bottom: 24px;
      background: #ffffff;
      padding: 10px 16px;
      border-radius: 10px;
      border: 1px solid var(--p-color-border);
    }
    .cb-nav-link {
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 14px;
      text-decoration: none;
      color: #5c5f62;
      transition: all 0.2s ease;
    }
    .cb-nav-link.active {
      background: #e8f5e9;
      color: var(--p-color-primary);
    }
    .cb-card {
      background: #ffffff;
      border-radius: 12px;
      border: 1px solid var(--p-color-border);
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    .cb-card-title {
      font-size: 18px;
      font-weight: 700;
      margin-top: 0;
      margin-bottom: 16px;
    }
    .cb-form-group {
      margin-bottom: 18px;
    }
    .cb-form-group label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .cb-form-group small {
      display: block;
      color: #6d7175;
      font-size: 12px;
      margin-top: 4px;
    }
    .cb-input {
      width: 100%;
      padding: 9px 12px;
      border: 1px solid #c9cccf;
      border-radius: 6px;
      font-size: 14px;
    }
    .cb-input:focus {
      outline: none;
      border-color: var(--p-color-primary);
      box-shadow: 0 0 0 1px var(--p-color-primary);
    }
    .cb-grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .cb-grid-3 {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 16px;
    }
    .cb-btn {
      background: var(--p-color-primary);
      color: #ffffff;
      border: none;
      padding: 10px 20px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      transition: background 0.2s ease;
    }
    .cb-btn:hover {
      background: var(--p-color-primary-hover);
    }
    /* Banner Preview */
    .cb-preview-box {
      background: #fafbfb;
      border: 1px dashed #c9cccf;
      border-radius: 8px;
      padding: 20px;
      text-align: center;
      margin-bottom: 16px;
    }
    .cb-preview-bar {
      margin: 10px 0;
      padding: 12px 16px;
      border-radius: 6px;
      background: #f4f6f8;
    }
    .cb-progress-track {
      width: 100%;
      height: 8px;
      background: #e0e0e0;
      border-radius: 9999px;
      overflow: hidden;
      margin-top: 8px;
    }
    .cb-progress-fill {
      width: 50%;
      height: 100%;
      background: #108043;
      transition: width 0.3s ease;
    }
    .cb-alert {
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 14px;
      margin-bottom: 20px;
    }
    .cb-alert-success { background: #e3fcef; color: #006644; border: 1px solid #abf5d1; }
    .cb-alert-error { background: #ffebe6; color: #de350b; border: 1px solid #ffbdad; }
  </style>
</head>
<body>
  <div class="cb-container">

    <!-- Top Navigation -->
    <nav class="cb-nav">
      <a href="index.php?shop=<?= urlencode($shop) ?>&host=<?= urlencode($host) ?>" class="cb-nav-link active">🚚 Shipping Bar</a>
      <a href="offers.php?shop=<?= urlencode($shop) ?>&host=<?= urlencode($host) ?>" class="cb-nav-link">🎁 Buy X Get Y (BOGO)</a>
    </nav>

    <?php if ($successMessage): ?>
      <div class="cb-alert cb-alert-success"><?= htmlspecialchars($successMessage) ?></div>
    <?php endif; ?>
    <?php if ($errorMessage): ?>
      <div class="cb-alert cb-alert-error"><?= htmlspecialchars($errorMessage) ?></div>
    <?php endif; ?>

    <!-- Interactive Live Preview Card -->
    <div class="cb-card">
      <h2 class="cb-card-title">Live Storefront Preview</h2>
      <div class="cb-preview-box">
        <div class="cb-preview-bar" id="previewBar">
          <div id="previewMessage" style="font-weight: 600; margin-bottom: 6px; color: <?= htmlspecialchars($settings['text_color']) ?>;">
            You're $25.00 away from FREE shipping!
          </div>
          <div class="cb-progress-track" id="previewTrack" style="background: <?= htmlspecialchars($settings['bar_bg_color']) ?>; height: <?= (int)$settings['bar_height'] ?>px; border-radius: <?= $settings['bar_shape'] === 'square' ? '0' : '9999px' ?>;">
            <div class="cb-progress-fill" id="previewFill" style="width: 50%; background: <?= htmlspecialchars($settings['bar_color']) ?>; border-radius: <?= $settings['bar_shape'] === 'square' ? '0' : '9999px' ?>;"></div>
          </div>
        </div>

        <div style="margin-top: 14px;">
          <label style="font-size: 13px; font-weight: 600; margin-right: 8px;">Simulate Cart Total:</label>
          <input type="range" id="simSlider" min="0" max="<?= (int)$settings['threshold_amount'] ?>" value="<?= (int)($settings['threshold_amount'] / 2) ?>" style="vertical-align: middle; width: 180px;">
          <span id="simValue" style="font-weight: 700; margin-left: 8px;">$<?= number_format($settings['threshold_amount'] / 2, 2) ?></span>
        </div>
      </div>
    </div>

    <!-- Configuration Form Card -->
    <div class="cb-card">
      <h2 class="cb-card-title">Shipping Bar Configuration</h2>
      <form method="POST">
        <div class="cb-form-group">
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
            <input type="checkbox" name="enabled" value="1" <?= $settings['enabled'] ? 'checked' : '' ?>>
            <span>Enable Free Shipping Bar on Storefront</span>
          </label>
        </div>

        <div class="cb-form-group">
          <label for="threshold_amount">Free Shipping Threshold ($)</label>
          <input type="number" step="0.01" min="1" id="threshold_amount" name="threshold_amount" class="cb-input" value="<?= htmlspecialchars((string)$settings['threshold_amount']) ?>" required>
          <small>The minimum cart total needed to unlock free shipping.</small>
        </div>

        <div class="cb-form-group">
          <label for="message">Progress Message</label>
          <input type="text" id="message" name="message" class="cb-input" value="<?= htmlspecialchars($settings['message']) ?>" required>
          <small>Use <code>{amount}</code> to display the remaining amount needed.</small>
        </div>

        <div class="cb-form-group">
          <label for="empty_message">Empty Cart Message</label>
          <input type="text" id="empty_message" name="empty_message" class="cb-input" value="<?= htmlspecialchars($settings['empty_message']) ?>" required>
          <small>Shown when shopper's cart is empty. Use <code>{amount}</code> for full threshold.</small>
        </div>

        <div class="cb-form-group">
          <label for="success_message">Goal Achieved Message</label>
          <input type="text" id="success_message" name="success_message" class="cb-input" value="<?= htmlspecialchars($settings['success_message']) ?>" required>
          <small>Shown when shopper reaches or exceeds the threshold.</small>
        </div>

        <h3 style="font-size: 15px; margin-top: 24px; margin-bottom: 12px;">Appearance & Colors</h3>

        <div class="cb-grid-3">
          <div class="cb-form-group">
            <label for="bar_color">Progress Bar Color</label>
            <input type="color" id="bar_color" name="bar_color" class="cb-input" style="height: 40px; padding: 2px;" value="<?= htmlspecialchars($settings['bar_color']) ?>">
          </div>
          <div class="cb-form-group">
            <label for="bar_bg_color">Track Background Color</label>
            <input type="color" id="bar_bg_color" name="bar_bg_color" class="cb-input" style="height: 40px; padding: 2px;" value="<?= htmlspecialchars($settings['bar_bg_color']) ?>">
          </div>
          <div class="cb-form-group">
            <label for="text_color">Text Color</label>
            <input type="color" id="text_color" name="text_color" class="cb-input" style="height: 40px; padding: 2px;" value="<?= htmlspecialchars($settings['text_color']) ?>">
          </div>
        </div>

        <div class="cb-grid-2">
          <div class="cb-form-group">
            <label for="bar_height">Bar Height (px)</label>
            <input type="number" min="4" max="24" id="bar_height" name="bar_height" class="cb-input" value="<?= (int)$settings['bar_height'] ?>">
          </div>
          <div class="cb-form-group">
            <label for="bar_shape">Bar Shape</label>
            <select id="bar_shape" name="bar_shape" class="cb-input">
              <option value="rounded" <?= $settings['bar_shape'] === 'rounded' ? 'selected' : '' ?>>Rounded Pill</option>
              <option value="square" <?= $settings['bar_shape'] === 'square' ? 'selected' : '' ?>>Square Corners</option>
            </select>
          </div>
        </div>

        <button type="submit" class="cb-btn">Save & Update Storefront</button>
      </form>
    </div>

  </div>

  <script>
    // Live Interactive Preview Script
    const slider = document.getElementById('simSlider');
    const simValue = document.getElementById('simValue');
    const fill = document.getElementById('previewFill');
    const track = document.getElementById('previewTrack');
    const msg = document.getElementById('previewMessage');
    const threshInput = document.getElementById('threshold_amount');
    const progTplInput = document.getElementById('message');
    const succTplInput = document.getElementById('success_message');
    const emptyTplInput = document.getElementById('empty_message');
    const barColorInput = document.getElementById('bar_color');
    const barBgColorInput = document.getElementById('bar_bg_color');
    const textColorInput = document.getElementById('text_color');
    const heightInput = document.getElementById('bar_height');
    const shapeInput = document.getElementById('bar_shape');

    function updatePreview() {
      const thresh = parseFloat(threshInput.value) || 50;
      const cart = parseFloat(slider.value) || 0;
      slider.max = thresh;
      simValue.textContent = '$' + cart.toFixed(2);

      let pct = thresh > 0 ? Math.min(100, (cart / thresh) * 100) : 100;
      fill.style.width = pct + '%';
      fill.style.background = barColorInput.value;
      track.style.background = barBgColorInput.value;
      track.style.height = heightInput.value + 'px';
      msg.style.color = textColorInput.value;

      const radius = shapeInput.value === 'square' ? '0' : '9999px';
      track.style.borderRadius = radius;
      fill.style.borderRadius = radius;

      const remaining = Math.max(0, thresh - cart);
      if (cart === 0) {
        msg.textContent = emptyTplInput.value.replace('{amount}', '$' + thresh.toFixed(2));
      } else if (cart >= thresh) {
        msg.textContent = succTplInput.value;
      } else {
        msg.textContent = progTplInput.value.replace('{amount}', '$' + remaining.toFixed(2));
      }
    }

    slider.addEventListener('input', updatePreview);
    [threshInput, progTplInput, succTplInput, emptyTplInput, barColorInput, barBgColorInput, textColorInput, heightInput, shapeInput]
      .forEach(el => el.addEventListener('input', updatePreview));

    updatePreview();
  </script>
</body>
</html>
