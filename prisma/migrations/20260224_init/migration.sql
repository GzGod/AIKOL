-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'TOKEN_EXPIRED', 'RATE_LIMITED', 'SUSPENDED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'APPROVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('PENDING', 'PROCESSING', 'POSTED', 'FAILED', 'BLOCKED', 'CANCELED');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('SUCCESS', 'FAIL', 'BLOCKED', 'RETRY_SCHEDULED');

-- CreateEnum
CREATE TYPE "ActivityLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "xUserId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "language" TEXT,
    "purpose" TEXT,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "healthMessage" TEXT,
    "minIntervalMinutes" INTEGER NOT NULL DEFAULT 20,
    "dailyPostLimit" INTEGER NOT NULL DEFAULT 50,
    "monthlyPostLimit" INTEGER NOT NULL DEFAULT 1000,
    "lastPostedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountGroupMember" (
    "accountId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountGroupMember_pkey" PRIMARY KEY ("accountId","groupId")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountTag" (
    "accountId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountTag_pkey" PRIMARY KEY ("accountId","tagId")
);

-- CreateTable
CREATE TABLE "Content" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "topic" TEXT,
    "language" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentVariant" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "accountId" TEXT,
    "body" TEXT NOT NULL,
    "similarityKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "contentVariantId" TEXT NOT NULL,
    "plannedAt" TIMESTAMP(3) NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextAttemptAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "externalPostId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishAttempt" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "status" "AttemptStatus" NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "httpStatus" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "rateLimitLimit" INTEGER,
    "rateLimitRemaining" INTEGER,
    "rateLimitResetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublishAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "limit" INTEGER,
    "remaining" INTEGER,
    "resetAt" TIMESTAMP(3),
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimitSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostMetric" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "reposts" INTEGER NOT NULL DEFAULT 0,
    "replies" INTEGER NOT NULL DEFAULT 0,
    "bookmarks" INTEGER NOT NULL DEFAULT 0,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "level" "ActivityLevel" NOT NULL DEFAULT 'INFO',
    "event" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "meta" JSONB,
    "accountId" TEXT,
    "scheduleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_xUserId_key" ON "Account"("xUserId");

-- CreateIndex
CREATE INDEX "Account_status_idx" ON "Account"("status");

-- CreateIndex
CREATE INDEX "Account_username_idx" ON "Account"("username");

-- CreateIndex
CREATE UNIQUE INDEX "AccountGroup_name_key" ON "AccountGroup"("name");

-- CreateIndex
CREATE INDEX "AccountGroupMember_groupId_idx" ON "AccountGroupMember"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "AccountTag_tagId_idx" ON "AccountTag"("tagId");

-- CreateIndex
CREATE INDEX "ContentVariant_contentId_idx" ON "ContentVariant"("contentId");

-- CreateIndex
CREATE INDEX "ContentVariant_accountId_idx" ON "ContentVariant"("accountId");

-- CreateIndex
CREATE INDEX "ContentVariant_similarityKey_idx" ON "ContentVariant"("similarityKey");

-- CreateIndex
CREATE UNIQUE INDEX "Schedule_idempotencyKey_key" ON "Schedule"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Schedule_plannedAt_status_idx" ON "Schedule"("plannedAt", "status");

-- CreateIndex
CREATE INDEX "Schedule_accountId_status_plannedAt_idx" ON "Schedule"("accountId", "status", "plannedAt");

-- CreateIndex
CREATE INDEX "Schedule_nextAttemptAt_status_idx" ON "Schedule"("nextAttemptAt", "status");

-- CreateIndex
CREATE INDEX "PublishAttempt_scheduleId_attemptNo_idx" ON "PublishAttempt"("scheduleId", "attemptNo");

-- CreateIndex
CREATE INDEX "PublishAttempt_accountId_requestedAt_idx" ON "PublishAttempt"("accountId", "requestedAt");

-- CreateIndex
CREATE INDEX "RateLimitSnapshot_accountId_endpoint_observedAt_idx" ON "RateLimitSnapshot"("accountId", "endpoint", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PostMetric_scheduleId_key" ON "PostMetric"("scheduleId");

-- CreateIndex
CREATE INDEX "PostMetric_accountId_collectedAt_idx" ON "PostMetric"("accountId", "collectedAt");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_accountId_createdAt_idx" ON "ActivityLog"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_scheduleId_createdAt_idx" ON "ActivityLog"("scheduleId", "createdAt");

-- AddForeignKey
ALTER TABLE "AccountGroupMember" ADD CONSTRAINT "AccountGroupMember_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountGroupMember" ADD CONSTRAINT "AccountGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AccountGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountTag" ADD CONSTRAINT "AccountTag_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountTag" ADD CONSTRAINT "AccountTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentVariant" ADD CONSTRAINT "ContentVariant_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentVariant" ADD CONSTRAINT "ContentVariant_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_contentVariantId_fkey" FOREIGN KEY ("contentVariantId") REFERENCES "ContentVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishAttempt" ADD CONSTRAINT "PublishAttempt_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishAttempt" ADD CONSTRAINT "PublishAttempt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateLimitSnapshot" ADD CONSTRAINT "RateLimitSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostMetric" ADD CONSTRAINT "PostMetric_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostMetric" ADD CONSTRAINT "PostMetric_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

