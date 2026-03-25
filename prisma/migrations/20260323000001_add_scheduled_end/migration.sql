-- AlterTable: add scheduledEndAt to sessions
ALTER TABLE "sessions" ADD COLUMN "scheduledEndAt" TIMESTAMP(3);
