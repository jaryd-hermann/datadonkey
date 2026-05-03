-- CreateTable
CREATE TABLE "Connection" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "userName" TEXT,
    "userCompany" TEXT,
    "userEmail" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'posthog',
    "credentials" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recallBotId" TEXT NOT NULL,
    "meetingUrl" TEXT NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "participants" TEXT,
    "transcript" TEXT,
    "followups" TEXT,
    "followupsAt" DATETIME,
    "emailSubject" TEXT,
    "emailDraft" TEXT,
    "emailDraftAt" DATETIME
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meetingId" TEXT NOT NULL,
    "askerName" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Question_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_recallBotId_key" ON "Meeting"("recallBotId");
