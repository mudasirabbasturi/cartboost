-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "thresholdAmount" REAL NOT NULL DEFAULT 50.0,
    "message" TEXT NOT NULL DEFAULT 'You''re {amount} away from FREE shipping!',
    "successMessage" TEXT NOT NULL DEFAULT 'Congratulations! You''ve unlocked FREE shipping!',
    "emptyMessage" TEXT NOT NULL DEFAULT 'Free shipping on orders over {amount}!',
    "barColor" TEXT NOT NULL DEFAULT '#108043',
    "barBgColor" TEXT NOT NULL DEFAULT '#e0e0e0',
    "textColor" TEXT NOT NULL DEFAULT '#202223',
    "barHeight" INTEGER NOT NULL DEFAULT 8,
    "barShape" TEXT NOT NULL DEFAULT 'rounded',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Settings_shop_key" ON "Settings"("shop");
