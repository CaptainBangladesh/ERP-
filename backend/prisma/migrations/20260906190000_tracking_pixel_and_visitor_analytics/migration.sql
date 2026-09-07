-- CreateTable
CREATE TABLE "tracking_sites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "pixel_key" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracking_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_view_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "tracking_site_id" UUID NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "session_id" TEXT,
    "path" TEXT NOT NULL,
    "referrer" TEXT,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_term" TEXT,
    "utm_content" TEXT,
    "country" TEXT,
    "device" TEXT,
    "browser" TEXT,
    "ip_hash" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_view_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tracking_sites_pixel_key_key" ON "tracking_sites"("pixel_key");
CREATE INDEX "tracking_sites_company_id_idx" ON "tracking_sites"("company_id");
CREATE INDEX "tracking_sites_brand_id_idx" ON "tracking_sites"("brand_id");
CREATE INDEX "tracking_sites_pixel_key_idx" ON "tracking_sites"("pixel_key");

-- CreateIndex
CREATE INDEX "page_view_events_company_id_idx" ON "page_view_events"("company_id");
CREATE INDEX "page_view_events_tracking_site_id_idx" ON "page_view_events"("tracking_site_id");
CREATE INDEX "page_view_events_visitor_id_idx" ON "page_view_events"("visitor_id");
CREATE INDEX "page_view_events_session_id_idx" ON "page_view_events"("session_id");
CREATE INDEX "page_view_events_timestamp_idx" ON "page_view_events"("timestamp");
CREATE INDEX "page_view_events_utm_campaign_idx" ON "page_view_events"("utm_campaign");

-- AddForeignKey
ALTER TABLE "tracking_sites" ADD CONSTRAINT "tracking_sites_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "marketing_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_view_events" ADD CONSTRAINT "page_view_events_tracking_site_id_fkey" FOREIGN KEY ("tracking_site_id") REFERENCES "tracking_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
