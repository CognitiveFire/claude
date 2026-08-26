CREATE TYPE "public"."availability" AS ENUM('IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK', 'DISCONTINUED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."campaign_state" AS ENUM('DRAFT', 'APPROVED', 'LIVE', 'PAUSED', 'KILLED');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('GBP', 'EUR', 'USD');--> statement-breakpoint
CREATE TYPE "public"."licensing_status" AS ENUM('NOT_REQUIRED', 'REQUIRED_NOT_OBTAINED', 'OBTAINED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('DRAFT', 'PRICED', 'PUBLISHED_DRAFT', 'LIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."data_provenance" AS ENUM('LIVE_API', 'FIXTURE');--> statement-breakpoint
CREATE TYPE "public"."rights_status" AS ENUM('UNKNOWN', 'REVIEW_REQUIRED', 'CLEARED', 'BLOCKED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "artworks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"artist" text,
	"source_path" text NOT NULL,
	"file_hash" text NOT NULL,
	"width_px" integer,
	"height_px" integer,
	"format" text,
	"colour_space" text,
	"has_alpha" boolean,
	"file_size_bytes" integer,
	"declared_dpi" integer,
	"artwork_rights_status" "rights_status" DEFAULT 'UNKNOWN' NOT NULL,
	"brand_reference_status" "rights_status" DEFAULT 'UNKNOWN' NOT NULL,
	"licensing_required" boolean,
	"licensing_status" "licensing_status" DEFAULT 'UNKNOWN' NOT NULL,
	"advertising_restrictions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"outcome" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"external_request" jsonb,
	"external_response" jsonb,
	"credential_fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"state" "campaign_state" DEFAULT 'DRAFT' NOT NULL,
	"meta_ad_account_id" text,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"daily_budget_minor" integer,
	"currency" "currency" DEFAULT 'GBP' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commerce_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"platform" text DEFAULT 'shopify' NOT NULL,
	"commerce_product_id" text NOT NULL,
	"handle" text,
	"admin_url" text,
	"status" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commerce_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_variant_id" uuid NOT NULL,
	"commerce_product_row_id" uuid NOT NULL,
	"commerce_variant_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "economic_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"product_variant_id" uuid,
	"producer_id" uuid NOT NULL,
	"provenance" "data_provenance" NOT NULL,
	"quoted_at" timestamp with time zone NOT NULL,
	"currency" "currency" NOT NULL,
	"retail_price_minor" integer NOT NULL,
	"shipping_charged_minor" integer NOT NULL,
	"garment_cost_minor" integer,
	"print_cost_minor" integer,
	"fulfilment_cost_minor" integer,
	"shipping_cost_minor" integer,
	"ad_cost_per_unit_minor" integer,
	"commercial_config" jsonb NOT NULL,
	"vat_minor" integer,
	"net_revenue_minor" integer,
	"payment_fees_minor" integer,
	"platform_fees_minor" integer,
	"returns_allowance_minor" integer,
	"contribution_before_ads_minor" integer,
	"contribution_after_ads_minor" integer,
	"gross_margin_pct" text,
	"contribution_margin_pct" text,
	"break_even_cpa_minor" integer,
	"break_even_roas" text,
	"target_cpa_minor" integer,
	"target_roas" text,
	"unknowns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_supplier_response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meta_asset_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_type" text NOT NULL,
	"meta_id" text NOT NULL,
	"business_id" text,
	"name_at_approval" text,
	"access_relationship" text,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" text NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meta_denied_businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" text NOT NULL,
	"label" text,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meta_identity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"approved_user_id" text NOT NULL,
	"identity_label" text,
	"token_fingerprint" text,
	"granted_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"established_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meta_spend_preflight_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"authenticated_user_id" text,
	"business_id" text,
	"ad_account_id" text,
	"campaign_id" text,
	"operation" text NOT NULL,
	"passed" boolean NOT NULL,
	"failure_reason" text,
	"token_fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "producer_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"producer_id" uuid NOT NULL,
	"producer_product_id" text NOT NULL,
	"producer_sync_product_id" text,
	"manufacturer_sku" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "producer_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_variant_id" uuid NOT NULL,
	"producer_product_row_id" uuid NOT NULL,
	"producer_variant_id" text NOT NULL,
	"producer_sku" text,
	"availability" "availability" DEFAULT 'UNKNOWN' NOT NULL,
	"availability_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "producers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"size" text,
	"colour" text,
	"price_minor" integer,
	"currency" "currency" DEFAULT 'GBP' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artwork_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "product_status" DEFAULT 'DRAFT' NOT NULL,
	"product_type" text NOT NULL,
	"description_html" text,
	"seo_title" text,
	"seo_description" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "commerce_products" ADD CONSTRAINT "commerce_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "commerce_variants" ADD CONSTRAINT "commerce_variants_product_variant_id_product_variants_id_fk" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "commerce_variants" ADD CONSTRAINT "commerce_variants_commerce_product_row_id_commerce_products_id_fk" FOREIGN KEY ("commerce_product_row_id") REFERENCES "public"."commerce_products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "economic_snapshots" ADD CONSTRAINT "economic_snapshots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "economic_snapshots" ADD CONSTRAINT "economic_snapshots_product_variant_id_product_variants_id_fk" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "economic_snapshots" ADD CONSTRAINT "economic_snapshots_producer_id_producers_id_fk" FOREIGN KEY ("producer_id") REFERENCES "public"."producers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "producer_products" ADD CONSTRAINT "producer_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "producer_products" ADD CONSTRAINT "producer_products_producer_id_producers_id_fk" FOREIGN KEY ("producer_id") REFERENCES "public"."producers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "producer_variants" ADD CONSTRAINT "producer_variants_product_variant_id_product_variants_id_fk" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "producer_variants" ADD CONSTRAINT "producer_variants_producer_product_row_id_producer_products_id_fk" FOREIGN KEY ("producer_product_row_id") REFERENCES "public"."producer_products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "products" ADD CONSTRAINT "products_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "artworks_file_hash_idx" ON "artworks" USING btree ("file_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "commerce_products_mapping_idx" ON "commerce_products" USING btree ("platform","commerce_product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commerce_products_product_idx" ON "commerce_products" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "commerce_variants_mapping_idx" ON "commerce_variants" USING btree ("commerce_product_row_id","commerce_variant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "economic_snapshots_product_idx" ON "economic_snapshots" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meta_asset_approvals_asset_idx" ON "meta_asset_approvals" USING btree ("asset_type","meta_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meta_denied_businesses_idx" ON "meta_denied_businesses" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "producer_products_mapping_idx" ON "producer_products" USING btree ("producer_id","producer_product_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "producer_variants_mapping_idx" ON "producer_variants" USING btree ("producer_product_row_id","producer_variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "producers_slug_idx" ON "producers" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_variants_sku_idx" ON "product_variants" USING btree ("sku");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_variants_product_idx" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "products_slug_idx" ON "products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_artwork_idx" ON "products" USING btree ("artwork_id");