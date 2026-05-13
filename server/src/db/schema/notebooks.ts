import { sql } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const notebooksTable = pgTable(
  "notebooks",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).notNull(),
    tag: varchar("tag", { length: 30 }).notNull().default("miscellaneous"),
    color: varchar("color", { length: 30 }).notNull().default("blue"),
    content: text("content").notNull().default(""),
    isPublic: boolean("is_public").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("IDX_notebooks_user").on(table.userId)],
);

export type NotebookRow = typeof notebooksTable.$inferSelect;
