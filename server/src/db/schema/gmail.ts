import { bigint, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

// Stores the Gmail OAuth tokens for the owner so the app can keep reading the
// contact@zakir.today inbox without re-prompting. One row per user (only the
// owner ever connects).
export const gmailTokensTable = pgTable("gmail_tokens", {
  userId: varchar("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  email: varchar("email"),
  accessToken: varchar("access_token"),
  refreshToken: varchar("refresh_token"),
  expiryDate: bigint("expiry_date", { mode: "number" }),
  scope: varchar("scope"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type GmailTokensRow = typeof gmailTokensTable.$inferSelect;
