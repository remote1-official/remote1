-- AlterTable: remove name column from users
ALTER TABLE "users" DROP COLUMN IF EXISTS "name";
