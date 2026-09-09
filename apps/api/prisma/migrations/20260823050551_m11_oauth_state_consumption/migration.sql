-- CreateTable
CREATE TABLE "OauthStateConsumption" (
    "id" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OauthStateConsumption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OauthStateConsumption_stateHash_key" ON "OauthStateConsumption"("stateHash");

-- CreateIndex
CREATE INDEX "OauthStateConsumption_expiresAt_idx" ON "OauthStateConsumption"("expiresAt");
