import { pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

/**
 * Tracks which device the user has marked as the source-of-truth.
 *
 * When a device claims dominance (Cmd/Ctrl+E), its `dominantDeviceId` and
 * `dominantSyncedAt` are written here. Other devices read this on load; if
 * the active dominant device differs from theirs and `dominantSyncedAt` is
 * newer than their last local pull, they wipe their local caches and pull
 * fresh data from the server before doing anything else.
 */
export const userSyncStateTable = pgTable("user_sync_state", {
  userId: varchar("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  dominantDeviceId: varchar("dominant_device_id"),
  dominantDeviceLabel: varchar("dominant_device_label"),
  dominantSyncedAt: timestamp("dominant_synced_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type UserSyncStateRow = typeof userSyncStateTable.$inferSelect;
