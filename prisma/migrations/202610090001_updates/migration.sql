CREATE TYPE "UpdateChannel" AS ENUM ('stable', 'beta');
CREATE TYPE "UpdateReleaseStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DISABLED');
ALTER TABLE "Installation"
 ADD COLUMN "updateChannel" "UpdateChannel" NOT NULL DEFAULT 'stable',
 ADD COLUMN "reportedVersion" VARCHAR(100),
 ADD COLUMN "lastUpdateCheckAt" TIMESTAMPTZ(3);
CREATE TABLE "UpdateRelease" (
 "id" UUID NOT NULL,
 "productId" UUID NOT NULL,
 "version" VARCHAR(100) NOT NULL,
 "channel" "UpdateChannel" NOT NULL,
 "mandatory" BOOLEAN NOT NULL DEFAULT false,
 "title" VARCHAR(200) NOT NULL,
 "notes" VARCHAR(10000) NOT NULL,
 "status" "UpdateReleaseStatus" NOT NULL DEFAULT 'DRAFT',
 "githubReleaseId" VARCHAR(100),
 "githubTag" VARCHAR(110) NOT NULL,
 "installerUrl" TEXT,
 "metadataUrl" TEXT,
 "sha256" CHAR(64),
 "dryRun" BOOLEAN NOT NULL DEFAULT true,
 "publicationLog" JSONB,
 "createdBy" UUID NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 "publishedAt" TIMESTAMPTZ(3),
 CONSTRAINT "UpdateRelease_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "UpdateRelease_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UpdateRelease_productId_version_key" ON "UpdateRelease"("productId", "version");
CREATE INDEX "UpdateRelease_productId_channel_status_idx" ON "UpdateRelease"("productId", "channel", "status");
