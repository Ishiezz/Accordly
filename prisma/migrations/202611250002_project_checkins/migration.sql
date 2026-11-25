ALTER TABLE "Deliverable" ADD COLUMN "reviewDate" TEXT;

CREATE TABLE "ProjectCheckIn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "baseVersion" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "concern" TEXT NOT NULL,
    "nextStep" TEXT NOT NULL,
    "reviewDate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decisionNote" TEXT,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectCheckIn_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectCheckIn_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProjectCheckIn_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ProjectCheckIn_projectId_createdAt_idx" ON "ProjectCheckIn"("projectId", "createdAt");
CREATE UNIQUE INDEX "ProjectCheckIn_one_pending_per_project" ON "ProjectCheckIn"("projectId") WHERE "status" = 'PENDING';
