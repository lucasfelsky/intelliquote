-- CreateTable
CREATE TABLE "_ItemFamilyToSupplier" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_ItemFamilyToSupplier_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_ItemFamilyToSupplier_B_index" ON "_ItemFamilyToSupplier"("B");

-- AddForeignKey
ALTER TABLE "_ItemFamilyToSupplier" ADD CONSTRAINT "_ItemFamilyToSupplier_A_fkey" FOREIGN KEY ("A") REFERENCES "ItemFamily"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ItemFamilyToSupplier" ADD CONSTRAINT "_ItemFamilyToSupplier_B_fkey" FOREIGN KEY ("B") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

