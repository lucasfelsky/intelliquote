-- CreateTable
-- Assinatura de e-mail por usuario (texto + imagem PNG/JPEG em bytea) usada no
-- e-mail da Ordem de Compra. Aditiva: nenhuma tabela existente e' alterada.
CREATE TABLE "UserEmailSignature" (
    "userId" INTEGER NOT NULL,
    "text" TEXT,
    "imageData" BYTEA,
    "imageMimeType" TEXT,
    "imageWidth" INTEGER,
    "imageHeight" INTEGER,
    "imageSize" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserEmailSignature_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "UserEmailSignature" ADD CONSTRAINT "UserEmailSignature_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
