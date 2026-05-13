import { jsonb, pgTable, primaryKey, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const revisionDataTable = pgTable(
  "revision_data",
  {
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    date: varchar("date", { length: 10 }).notNull(),
    data: jsonb("data").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [primaryKey({ columns: [table.userId, table.date] })],
);

export type RevisionDayRow = typeof revisionDataTable.$inferSelect;
