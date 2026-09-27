-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'USER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'USER';

-- DataMigration: numa instalação que já tenha usuários antes desta migração,
-- todos nasceriam USER pelo DEFAULT acima e ninguém teria acesso a /users
-- (@Roles(ADMIN)). Promove deterministicamente o usuário mais antigo a ADMIN.
-- Em uma instalação nova (tabela vazia), este UPDATE não afeta nenhuma linha
-- e o bootstrap normal do primeiro registro assume o papel.
UPDATE "User"
SET "role" = 'ADMIN'
WHERE "id" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1);
