-- Migration: add analysis_results table
-- Stores AI analysis output per test run so it survives server restart.

CREATE TABLE IF NOT EXISTS "analysis_results" (
  "run_id" text PRIMARY KEY NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "error" text,
  "report" jsonb,
  "bugs" jsonb,
  "rca_reports" jsonb,
  "bottlenecks" jsonb,
  "prediction" jsonb,
  "cost_usd" real,
  "analyzed_at" timestamp,
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_analysis_results_status"
  ON "analysis_results" ("status");
