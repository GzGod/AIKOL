-- CreateEnum
CREATE TYPE "ProxyProtocol" AS ENUM ('HTTP', 'HTTPS');

-- AlterTable
ALTER TABLE "Account"
ADD COLUMN "proxyEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "proxyProtocol" "ProxyProtocol",
ADD COLUMN "proxyHost" TEXT,
ADD COLUMN "proxyPort" INTEGER,
ADD COLUMN "proxyUsername" TEXT,
ADD COLUMN "proxyPasswordEncrypted" TEXT;
