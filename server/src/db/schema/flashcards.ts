import { sql } from "drizzle-orm";
import {
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

/**
 * Flashcard decks. A deck is a named bucket of cards, optionally associated
 * with a subject and module so we can roll review activity into per-subject
 * stats on the Calendar / Stats pages.
 */
export const flashcardDecksTable = pgTable(
  "flashcard_decks",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    // "biology" | "chemistry" | "maths" | "miscellaneous"
    subject: varchar("subject", { length: 30 }).notNull().default("miscellaneous"),
    color: varchar("color", { length: 30 }).notNull().default("blue"),
    description: text("description").notNull().default(""),
    // Nullable self-reference for nested / sub-decks. Cascading delete means
    // deleting a parent removes its entire subtree (and their cards).
    parentId: varchar("parent_id").references((): any => flashcardDecksTable.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("IDX_flashcard_decks_user").on(table.userId)],
);

/**
 * Individual flashcards. Two types are supported:
 *   - basic: independent `front` and `back` markdown bodies (Anki-style
 *     question/answer).
 *   - cloze: a single `front` body containing `{{c1::answer}}` markers; the
 *     reviewer hides the answer and the user has to fill in up to 3 blanks.
 *     `back` is used as an optional explanation shown after revealing.
 *
 * SR fields implement an SM-2 (Anki-classic) scheduler. `dueAt` is the next
 * review time; `interval` is the most recent gap in days; `ease` is the
 * ease factor (default 2.5); `reps` is consecutive correct answers; `lapses`
 * is total times the user pressed "Again".
 */
export const flashcardsTable = pgTable(
  "flashcards",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    deckId: varchar("deck_id")
      .notNull()
      .references(() => flashcardDecksTable.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 20 }).notNull().default("basic"),
    front: text("front").notNull().default(""),
    back: text("back").notNull().default(""),
    tags: text("tags").notNull().default(""),
    // SM-2 scheduler state
    dueAt: timestamp("due_at", { withTimezone: true }).notNull().defaultNow(),
    interval: doublePrecision("interval").notNull().default(0),
    ease: doublePrecision("ease").notNull().default(2.5),
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    suspended: integer("suspended").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("IDX_flashcards_user").on(table.userId),
    index("IDX_flashcards_deck").on(table.deckId),
    index("IDX_flashcards_due").on(table.userId, table.dueAt),
  ],
);

/**
 * One row per individual review event. Used for analytics (daily review
 * counts, time spent, accuracy trends) and to integrate with Stats. Rating
 * uses the Anki convention: 1 = Again, 2 = Hard, 3 = Good, 4 = Easy.
 */
export const flashcardReviewsTable = pgTable(
  "flashcard_reviews",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    cardId: varchar("card_id")
      .notNull()
      .references(() => flashcardsTable.id, { onDelete: "cascade" }),
    deckId: varchar("deck_id")
      .notNull()
      .references(() => flashcardDecksTable.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    durationMs: integer("duration_ms").notNull().default(0),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // YYYY-MM-DD in the user's local time at review time. Lets us aggregate
    // by calendar day without doing TZ math at read time.
    dateKey: varchar("date_key", { length: 10 }).notNull(),
  },
  (table) => [
    index("IDX_flashcard_reviews_user").on(table.userId),
    index("IDX_flashcard_reviews_card").on(table.cardId),
    index("IDX_flashcard_reviews_user_date").on(table.userId, table.dateKey),
  ],
);

export type FlashcardDeckRow = typeof flashcardDecksTable.$inferSelect;
export type FlashcardRow = typeof flashcardsTable.$inferSelect;
export type FlashcardReviewRow = typeof flashcardReviewsTable.$inferSelect;
