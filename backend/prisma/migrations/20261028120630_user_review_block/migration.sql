-- CreateTable
CREATE TABLE "ReviewBlockItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "masteredAt" TIMESTAMP(3),

    CONSTRAINT "ReviewBlockItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewBlockItem_userId_masteredAt_idx" ON "ReviewBlockItem"("userId", "masteredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewBlockItem_userId_questionId_key" ON "ReviewBlockItem"("userId", "questionId");

-- AddForeignKey
ALTER TABLE "ReviewBlockItem" ADD CONSTRAINT "ReviewBlockItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewBlockItem" ADD CONSTRAINT "ReviewBlockItem_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
