// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const datasets = sqliteTable("datasets", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  sourceKey: text("source_key").notNull(),
  optimizedKey: text("optimized_key"),
  status: text("status").notNull().default("uploaded"),
  pointCount: integer("point_count").notNull().default(0),
  fieldCount: integer("field_count").notNull().default(0),
  minLon: real("min_lon"), maxLon: real("max_lon"), minLat: real("min_lat"), maxLat: real("max_lat"),
  schemaJson: text("schema_json"),
  createdAt: integer("created_at").notNull(),
});

export const uploadSessions = sqliteTable("upload_sessions", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  objectKey: text("object_key").notNull(),
  r2UploadId: text("r2_upload_id").notNull(),
  filename: text("filename").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: integer("created_at").notNull(),
});
