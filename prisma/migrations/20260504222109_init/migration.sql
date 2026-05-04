-- CreateTable
CREATE TABLE "Connection" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "userName" TEXT,
    "userCompany" TEXT,
    "userEmail" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'posthog',
    "credentials" TEXT,
    "prefLive" BOOLEAN NOT NULL DEFAULT true,
    "prefFollowup" BOOLEAN NOT NULL DEFAULT true,
    "calendarConnected" BOOLEAN NOT NULL DEFAULT false,
    "calendarProvider" TEXT,
    "slackConnected" BOOLEAN NOT NULL DEFAULT false,
    "slackTeamName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "recallBotId" TEXT NOT NULL,
    "meetingUrl" TEXT NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "participants" TEXT,
    "transcript" TEXT,
    "followups" TEXT,
    "followupsAt" TIMESTAMP(3),
    "emailSubject" TEXT,
    "emailDraft" TEXT,
    "emailDraftAt" TIMESTAMP(3),

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "askerName" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_recallBotId_key" ON "Meeting"("recallBotId");

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
