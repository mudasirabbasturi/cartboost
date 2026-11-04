-- CreateTable
CREATE TABLE "DiscountOffer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopifyDiscountId" TEXT,
    "title" TEXT NOT NULL DEFAULT 'Buy 2 Get 1 FREE',
    "buyQuantity" INTEGER NOT NULL DEFAULT 2,
    "getQuantity" INTEGER NOT NULL DEFAULT 1,
    "discountPercentage" REAL NOT NULL DEFAULT 100.0,
    "appliesToAll" BOOLEAN NOT NULL DEFAULT true,
    "eligibleProductIds" TEXT NOT NULL DEFAULT '[]',
    "sameProductOnly" BOOLEAN NOT NULL DEFAULT false,
    "combinesWithOrder" BOOLEAN NOT NULL DEFAULT true,
    "combinesWithProduct" BOOLEAN NOT NULL DEFAULT true,
    "combinesWithShipping" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
