import { sql } from "drizzle-orm";
import { bigint, boolean, index, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const foldersTable = pgTable(
  "folders",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("IDX_folders_user").on(table.userId)],
);

export const photosTable = pgTable(
  "photos",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    folderId: varchar("folder_id").references(() => foldersTable.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 300 }).notNull(),
    objectPath: varchar("object_path", { length: 500 }).notNull().unique(),
    contentType: varchar("content_type", { length: 100 }).notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    isPublic: boolean("is_public").notNull().default(false),
  },
  (table) => [
    index("IDX_photos_user").on(table.userId),
    index("IDX_photos_folder").on(table.folderId),
    index("IDX_photos_deleted").on(table.deletedAt),
  ],
);

export type FolderRow = typeof foldersTable.$inferSelect;
export type PhotoRow = typeof photosTable.$inferSelect;
