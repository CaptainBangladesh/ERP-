-- CreateTable
CREATE TABLE "skeleton_probe" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skeleton_probe_pkey" PRIMARY KEY ("id")
);
