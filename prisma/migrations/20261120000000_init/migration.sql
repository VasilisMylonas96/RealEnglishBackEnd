-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "birthDate" TIMESTAMP(3),
    "username" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'STUDENT',
    "level" TEXT,
    "avatarUrl" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InviteToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT NOT NULL,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "usedById" TEXT,
    "createdById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InviteToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageContents" (
    "id" TEXT NOT NULL,
    "page_key" TEXT NOT NULL,
    "element_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "styles" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageContents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "gallery_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "role" TEXT,
    "author" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "photo" TEXT,
    "reviewDate" TIMESTAMP(3) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "authorName" TEXT NOT NULL DEFAULT 'Real English Academy',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "instagramMediaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "cefrLevel" TEXT,
    "difficulty" TEXT NOT NULL,
    "questionType" TEXT NOT NULL DEFAULT 'MULTIPLE_CHOICE',
    "topicSyllabusTag" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "options" TEXT NOT NULL,
    "questionData" TEXT,
    "correctAnswer" INTEGER NOT NULL,
    "correctAnswerText" TEXT,
    "explanation" TEXT,
    "sourceFlag" TEXT,
    "isScannedSource" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT,
    "points" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizExtractionJob" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sourceFlag" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "totalBatches" INTEGER NOT NULL DEFAULT 0,
    "doneBatches" INTEGER NOT NULL DEFAULT 0,
    "questionsJson" TEXT,
    "error" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizExtractionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizModeConfig" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "onlyScannedQuestions" BOOLEAN NOT NULL DEFAULT false,
    "allowedSourceFlags" TEXT,
    "typeDistributionJson" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizModeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quizType" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "totalQuestions" INTEGER NOT NULL,
    "correctCount" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "durationSec" INTEGER,
    "answers" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matchId" TEXT,

    CONSTRAINT "QuizAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tournament" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 15,
    "finalDurationMin" INTEGER NOT NULL DEFAULT 20,
    "questionCount" INTEGER NOT NULL DEFAULT 20,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentParticipant" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "bracketPosition" INTEGER,
    "isEliminated" BOOLEAN NOT NULL DEFAULT false,
    "score" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentMatch" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "participantAId" TEXT,
    "participantBId" TEXT,
    "participantAStartedAt" TIMESTAMP(3),
    "participantBStartedAt" TIMESTAMP(3),
    "participantACompletedAt" TIMESTAMP(3),
    "participantBCompletedAt" TIMESTAMP(3),
    "participantAScore" INTEGER,
    "participantBScore" INTEGER,
    "winnerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentTieBreaker" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "questionId" TEXT NOT NULL,
    "participantAAnswer" INTEGER,
    "participantBAnswer" INTEGER,
    "participantACompletedAt" TIMESTAMP(3),
    "participantBCompletedAt" TIMESTAMP(3),
    "winnerId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentTieBreaker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderboardEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totalPoints" INTEGER NOT NULL DEFAULT 0,
    "dailyPoints" INTEGER NOT NULL DEFAULT 0,
    "weeklyPoints" INTEGER NOT NULL DEFAULT 0,
    "academicYear" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaderboardEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HallOfFame" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "academicYear" TEXT NOT NULL,
    "totalPoints" INTEGER NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HallOfFame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'LESSON',
    "mode" TEXT NOT NULL DEFAULT 'VIDEO',
    "createdById" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "endDate" TIMESTAMP(3),
    "daysOfWeek" TEXT,
    "schedules" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEventStudent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEventStudent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEventGroup" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEventGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoCallSession" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "jitsiRoomId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoCallSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "linkUrl" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Friendship" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "addresseeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "participantOneId" TEXT NOT NULL,
    "participantTwoId" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isEdited" BOOLEAN NOT NULL DEFAULT false,
    "lastEditedBy" TEXT,
    "editHistory" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "attachments" TEXT,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatGroupMessage" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isEdited" BOOLEAN NOT NULL DEFAULT false,
    "lastEditedBy" TEXT,
    "editHistory" TEXT,
    "attachments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatGroupMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatGroupMessageRead" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatGroupMessageRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiApiKey" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProviderState" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "activeProvider" TEXT NOT NULL DEFAULT 'gemini',
    "lockedUntil" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProviderState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "InviteToken_token_key" ON "InviteToken"("token");

-- CreateIndex
CREATE INDEX "InviteToken_token_idx" ON "InviteToken"("token");

-- CreateIndex
CREATE INDEX "InviteToken_email_idx" ON "InviteToken"("email");

-- CreateIndex
CREATE INDEX "InviteToken_createdById_idx" ON "InviteToken"("createdById");

-- CreateIndex
CREATE INDEX "PageContents_page_key_idx" ON "PageContents"("page_key");

-- CreateIndex
CREATE UNIQUE INDEX "PageContents_page_key_element_id_key" ON "PageContents"("page_key", "element_id");

-- CreateIndex
CREATE UNIQUE INDEX "MediaCategory_slug_key" ON "MediaCategory"("slug");

-- CreateIndex
CREATE INDEX "MediaAsset_gallery_id_idx" ON "MediaAsset"("gallery_id");

-- CreateIndex
CREATE UNIQUE INDEX "Review_userId_key" ON "Review"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Announcement_instagramMediaId_key" ON "Announcement"("instagramMediaId");

-- CreateIndex
CREATE INDEX "Announcement_createdAt_idx" ON "Announcement"("createdAt");

-- CreateIndex
CREATE INDEX "Question_level_difficulty_idx" ON "Question"("level", "difficulty");

-- CreateIndex
CREATE INDEX "Question_level_topicSyllabusTag_idx" ON "Question"("level", "topicSyllabusTag");

-- CreateIndex
CREATE INDEX "Question_status_cefrLevel_questionType_isScannedSource_idx" ON "Question"("status", "cefrLevel", "questionType", "isScannedSource");

-- CreateIndex
CREATE INDEX "Question_sourceFlag_idx" ON "Question"("sourceFlag");

-- CreateIndex
CREATE INDEX "Question_questionText_idx" ON "Question"("questionText");

-- CreateIndex
CREATE UNIQUE INDEX "QuizModeConfig_mode_key" ON "QuizModeConfig"("mode");

-- CreateIndex
CREATE INDEX "QuizAttempt_userId_quizType_idx" ON "QuizAttempt"("userId", "quizType");

-- CreateIndex
CREATE INDEX "QuizAttempt_userId_completedAt_idx" ON "QuizAttempt"("userId", "completedAt");

-- CreateIndex
CREATE INDEX "QuizAttempt_matchId_idx" ON "QuizAttempt"("matchId");

-- CreateIndex
CREATE INDEX "Tournament_status_scheduledAt_idx" ON "Tournament"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "TournamentParticipant_tournamentId_level_idx" ON "TournamentParticipant"("tournamentId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentParticipant_tournamentId_userId_key" ON "TournamentParticipant"("tournamentId", "userId");

-- CreateIndex
CREATE INDEX "TournamentMatch_tournamentId_round_idx" ON "TournamentMatch"("tournamentId", "round");

-- CreateIndex
CREATE INDEX "TournamentTieBreaker_matchId_round_idx" ON "TournamentTieBreaker"("matchId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentTieBreaker_matchId_round_key" ON "TournamentTieBreaker"("matchId", "round");

-- CreateIndex
CREATE INDEX "LeaderboardEntry_academicYear_totalPoints_idx" ON "LeaderboardEntry"("academicYear", "totalPoints");

-- CreateIndex
CREATE UNIQUE INDEX "LeaderboardEntry_userId_academicYear_key" ON "LeaderboardEntry"("userId", "academicYear");

-- CreateIndex
CREATE UNIQUE INDEX "HallOfFame_userId_category_academicYear_key" ON "HallOfFame"("userId", "category", "academicYear");

-- CreateIndex
CREATE INDEX "Group_createdById_idx" ON "Group"("createdById");

-- CreateIndex
CREATE INDEX "GroupMember_studentId_idx" ON "GroupMember"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_groupId_studentId_key" ON "GroupMember"("groupId", "studentId");

-- CreateIndex
CREATE INDEX "CalendarEvent_createdById_idx" ON "CalendarEvent"("createdById");

-- CreateIndex
CREATE INDEX "CalendarEvent_startDate_idx" ON "CalendarEvent"("startDate");

-- CreateIndex
CREATE INDEX "CalendarEventStudent_studentId_idx" ON "CalendarEventStudent"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEventStudent_eventId_studentId_key" ON "CalendarEventStudent"("eventId", "studentId");

-- CreateIndex
CREATE INDEX "CalendarEventGroup_groupId_idx" ON "CalendarEventGroup"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEventGroup_eventId_groupId_key" ON "CalendarEventGroup"("eventId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoCallSession_eventId_key" ON "VideoCallSession"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoCallSession_jitsiRoomId_key" ON "VideoCallSession"("jitsiRoomId");

-- CreateIndex
CREATE INDEX "VideoCallSession_hostId_idx" ON "VideoCallSession"("hostId");

-- CreateIndex
CREATE INDEX "VideoCallSession_status_idx" ON "VideoCallSession"("status");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Friendship_addresseeId_status_idx" ON "Friendship"("addresseeId", "status");

-- CreateIndex
CREATE INDEX "Friendship_requesterId_status_idx" ON "Friendship"("requesterId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Friendship_requesterId_addresseeId_key" ON "Friendship"("requesterId", "addresseeId");

-- CreateIndex
CREATE INDEX "Conversation_lastMessageAt_idx" ON "Conversation"("lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_participantOneId_participantTwoId_key" ON "Conversation"("participantOneId", "participantTwoId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_senderId_idx" ON "Message"("senderId");

-- CreateIndex
CREATE INDEX "ChatGroup_createdById_idx" ON "ChatGroup"("createdById");

-- CreateIndex
CREATE INDEX "ChatGroupMember_studentId_idx" ON "ChatGroupMember"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatGroupMember_groupId_studentId_key" ON "ChatGroupMember"("groupId", "studentId");

-- CreateIndex
CREATE INDEX "ChatGroupMessage_groupId_createdAt_idx" ON "ChatGroupMessage"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatGroupMessage_senderId_idx" ON "ChatGroupMessage"("senderId");

-- CreateIndex
CREATE INDEX "ChatGroupMessageRead_userId_idx" ON "ChatGroupMessageRead"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatGroupMessageRead_messageId_userId_key" ON "ChatGroupMessageRead"("messageId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AiApiKey_provider_key" ON "AiApiKey"("provider");

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventStudent" ADD CONSTRAINT "CalendarEventStudent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventStudent" ADD CONSTRAINT "CalendarEventStudent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventGroup" ADD CONSTRAINT "CalendarEventGroup_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventGroup" ADD CONSTRAINT "CalendarEventGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoCallSession" ADD CONSTRAINT "VideoCallSession_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_addresseeId_fkey" FOREIGN KEY ("addresseeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_participantOneId_fkey" FOREIGN KEY ("participantOneId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_participantTwoId_fkey" FOREIGN KEY ("participantTwoId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatGroup" ADD CONSTRAINT "ChatGroup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatGroupMember" ADD CONSTRAINT "ChatGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ChatGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatGroupMember" ADD CONSTRAINT "ChatGroupMember_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatGroupMessage" ADD CONSTRAINT "ChatGroupMessage_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ChatGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatGroupMessage" ADD CONSTRAINT "ChatGroupMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatGroupMessageRead" ADD CONSTRAINT "ChatGroupMessageRead_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatGroupMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatGroupMessageRead" ADD CONSTRAINT "ChatGroupMessageRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

