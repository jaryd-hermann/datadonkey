-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN "followups" TEXT;
ALTER TABLE "Meeting" ADD COLUMN "followupsAt" DATETIME;
ALTER TABLE "Meeting" ADD COLUMN "participants" TEXT;
ALTER TABLE "Meeting" ADD COLUMN "title" TEXT;
ALTER TABLE "Meeting" ADD COLUMN "transcript" TEXT;
