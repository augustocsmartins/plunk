-- WhatsApp (Evolution API) support for transactional messages and workflow steps.
--
-- Both tables are new and empty, so their indexes cost nothing to build here.
-- ADD VALUE on "WorkflowStepType" runs inside the migration's transaction on Postgres 12+;
-- the value is only used by application code after it commits.

ALTER TYPE "WorkflowStepType" ADD VALUE 'SEND_WHATSAPP';

-- CreateEnum
CREATE TYPE "WhatsAppConnectionStatus" AS ENUM ('DISCONNECTED', 'QR_PENDING', 'CONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "WhatsAppSourceType" AS ENUM ('TRANSACTIONAL', 'WORKFLOW');

-- CreateEnum
CREATE TYPE "WhatsAppMessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateTable
CREATE TABLE "whatsapp_connections" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "instanceName" TEXT NOT NULL,
    "tokenEncrypted" TEXT,
    "webhookSecret" TEXT NOT NULL,
    "status" "WhatsAppConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "phoneJid" TEXT,
    "connectedAt" TIMESTAMP(3),
    "webhookRegisteredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contactId" TEXT,
    "phone" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sourceType" "WhatsAppSourceType" NOT NULL,
    "status" "WhatsAppMessageStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "externalId" TEXT,
    "workflowExecutionId" TEXT,
    "workflowStepExecutionId" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_connections_projectId_key" ON "whatsapp_connections"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_connections_instanceName_key" ON "whatsapp_connections"("instanceName");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_connections_webhookSecret_key" ON "whatsapp_connections"("webhookSecret");

-- CreateIndex
CREATE INDEX "whatsapp_messages_projectId_createdAt_idx" ON "whatsapp_messages"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "whatsapp_messages_contactId_idx" ON "whatsapp_messages"("contactId");

-- CreateIndex
CREATE INDEX "whatsapp_messages_externalId_idx" ON "whatsapp_messages"("externalId");

-- AddForeignKey
ALTER TABLE "whatsapp_connections" ADD CONSTRAINT "whatsapp_connections_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
