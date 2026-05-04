-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Connection" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
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
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Connection" ("credentials", "id", "provider", "updatedAt", "userCompany", "userEmail", "userName") SELECT "credentials", "id", "provider", "updatedAt", "userCompany", "userEmail", "userName" FROM "Connection";
DROP TABLE "Connection";
ALTER TABLE "new_Connection" RENAME TO "Connection";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
