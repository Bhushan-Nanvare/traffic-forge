import { pgTable, text, serial, integer, real, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const testConfigsTable = pgTable("test_configs", {
  id: serial("id").primaryKey(),
  url: text("url").notNull(),
  user_count: integer("user_count").default(10),
  duration_sec: integer("duration_sec").default(60),
  ramp_up_sec: integer("ramp_up_sec").default(10),
  app_type: text("app_type"),
  persona: text("persona"),
  shadow_mode: boolean("shadow_mode").default(false),
  respect_rate_limits: boolean("respect_rate_limits").default(true),
  auto_stop_error_threshold: integer("auto_stop_error_threshold").default(10),
  discovered_paths: jsonb("discovered_paths").$type<string[]>(),
  created_at: timestamp("created_at").defaultNow(),
  test_mode: text("test_mode").default("http"),
  browser_user_count: integer("browser_user_count").default(3),
  browser_duration_sec: integer("browser_duration_sec").default(60),
  browser_ramp_up_sec: integer("browser_ramp_up_sec").default(5),
  login_username: text("login_username"),
  login_password: text("login_password"),
});

export const testRunsTable = pgTable("test_runs", {
  id: text("id").primaryKey(),
  config_id: integer("config_id"),
  status: text("status").default("pending"),
  total_requests: integer("total_requests"),
  error_rate: real("error_rate"),
  avg_response_ms: real("avg_response_ms"),
  p50_ms: integer("p50_ms"),
  p95_ms: integer("p95_ms"),
  p99_ms: integer("p99_ms"),
  passed: boolean("passed"),
  user_count: integer("user_count"),
  started_at: timestamp("started_at"),
  ended_at: timestamp("ended_at"),
  created_at: timestamp("created_at").defaultNow(),
  page_metrics: jsonb("page_metrics").$type<Record<string, { count: number; avgMs: number; errors: number }>>(),
  error_breakdown: jsonb("error_breakdown").$type<Record<string, number>>(),
});

export const insertTestConfigSchema = createInsertSchema(testConfigsTable).omit({ id: true, created_at: true });
export const insertTestRunSchema = createInsertSchema(testRunsTable).omit({ created_at: true });

export type InsertTestConfig = z.infer<typeof insertTestConfigSchema>;
export type TestConfig = typeof testConfigsTable.$inferSelect;
export type InsertTestRun = z.infer<typeof insertTestRunSchema>;
export type TestRun = typeof testRunsTable.$inferSelect;
