-- AlterTable
ALTER TABLE "CatalogItem" ADD COLUMN     "familyId" INTEGER;

-- CreateTable
CREATE TABLE "ItemFamily" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemFamily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ItemFamily_name_key" ON "ItemFamily"("name");

-- CreateIndex
CREATE INDEX "CatalogItem_familyId_idx" ON "CatalogItem"("familyId");

-- AddForeignKey
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "ItemFamily"("id") ON DELETE SET NULL ON UPDATE CASCADE;
