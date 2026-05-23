import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  flashcardDecksTable,
  flashcardsTable,
  flashcardReviewsTable,
} from "../db";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import multer from "multer";
import { parseApkg, type ParsedCard as ApkgCard } from "../anki";

const router: IRouter = Router();

// 32MB cap covers most exported Anki decks. Buffered in memory because we
// don't want temp files lying around between requests.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 32 * 1024 * 1024 } });

const ALLOWED_SUBJECTS = ["maths", "biology", "chemistry", "miscellaneous"] as const;
const ALLOWED_COLORS = [
  "blue", "green", "red", "amber", "purple", "pink", "teal", "slate", "orange", "indigo",
] as const;
const ALLOWED_TYPES = ["basic", "cloze"] as const;

function requireAuth(req: Request, res: Response): string | null {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return req.user.id;
}

// ───────────────────────── Deck schemas ─────────────────────────

const CreateDeckBody = z.object({
  name: z.string().trim().min(1).max(200),
  subject: z.enum(ALLOWED_SUBJECTS).optional(),
  color: z.enum(ALLOWED_COLORS).optional(),
  description: z.string().optional(),
  parentId: z.string().min(1).nullable().optional(),
});

const UpdateDeckBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  subject: z.enum(ALLOWED_SUBJECTS).optional(),
  color: z.enum(ALLOWED_COLORS).optional(),
  description: z.string().optional(),
  parentId: z.string().min(1).nullable().optional(),
});

function serializeDeck(d: typeof flashcardDecksTable.$inferSelect) {
  return {
    id: d.id,
    name: d.name,
    subject: d.subject,
    color: d.color,
    description: d.description,
    parentId: d.parentId,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

/**
 * Resolve the full set of deck ids that belong to `rootId` plus all of its
 * descendants (BFS). Used so that studying or browsing a parent deck pulls
 * in cards from all its subdecks. Bounded by `maxDepth` to defend against
 * pathological cycles even though we also forbid them at write time.
 */
async function expandDeckSubtree(userId: string, rootId: string): Promise<string[]> {
  const all = await db
    .select({ id: flashcardDecksTable.id, parentId: flashcardDecksTable.parentId })
    .from(flashcardDecksTable)
    .where(eq(flashcardDecksTable.userId, userId));
  const childrenOf = new Map<string, string[]>();
  for (const row of all) {
    if (!row.parentId) continue;
    const arr = childrenOf.get(row.parentId) ?? [];
    arr.push(row.id);
    childrenOf.set(row.parentId, arr);
  }
  const out: string[] = [];
  const queue = [rootId];
  const seen = new Set<string>();
  let depth = 0;
  while (queue.length > 0 && depth < 64) {
    const next: string[] = [];
    for (const id of queue) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      for (const c of childrenOf.get(id) ?? []) next.push(c);
    }
    queue.length = 0;
    queue.push(...next);
    depth++;
  }
  return out;
}

/** True if `candidateParentId` is `deckId` itself or one of its descendants. */
async function wouldCreateCycle(
  userId: string,
  deckId: string,
  candidateParentId: string,
): Promise<boolean> {
  if (candidateParentId === deckId) return true;
  const subtree = await expandDeckSubtree(userId, deckId);
  return subtree.includes(candidateParentId);
}

function serializeCard(c: typeof flashcardsTable.$inferSelect) {
  return {
    id: c.id,
    deckId: c.deckId,
    type: c.type,
    front: c.front,
    back: c.back,
    tags: c.tags,
    dueAt: c.dueAt.toISOString(),
    interval: c.interval,
    ease: c.ease,
    reps: c.reps,
    lapses: c.lapses,
    suspended: c.suspended,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

// ───────────────────────── Decks ─────────────────────────

router.get("/flashcard-decks", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const rows = await db
    .select()
    .from(flashcardDecksTable)
    .where(eq(flashcardDecksTable.userId, userId))
    .orderBy(desc(flashcardDecksTable.updatedAt));
  // Counts per deck (total / due / new) — one round-trip via group-by.
  const now = new Date();
  const counts = await db
    .select({
      deckId: flashcardsTable.deckId,
      total: sql<number>`count(*)::int`,
      due: sql<number>`sum(case when ${flashcardsTable.dueAt} <= ${now} and ${flashcardsTable.suspended} = 0 then 1 else 0 end)::int`,
      fresh: sql<number>`sum(case when ${flashcardsTable.reps} = 0 then 1 else 0 end)::int`,
    })
    .from(flashcardsTable)
    .where(eq(flashcardsTable.userId, userId))
    .groupBy(flashcardsTable.deckId);
  const countMap = new Map(counts.map(c => [c.deckId, c]));
  res.json({
    decks: rows.map(d => ({
      ...serializeDeck(d),
      total: countMap.get(d.id)?.total ?? 0,
      due: countMap.get(d.id)?.due ?? 0,
      fresh: countMap.get(d.id)?.fresh ?? 0,
    })),
  });
});

router.get("/flashcard-decks/:id", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const id = String(req.params["id"]);
  const [row] = await db
    .select()
    .from(flashcardDecksTable)
    .where(and(eq(flashcardDecksTable.id, id), eq(flashcardDecksTable.userId, userId)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }
  res.json(serializeDeck(row));
});

router.post("/flashcard-decks", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const parsed = CreateDeckBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid deck body" });
    return;
  }
  let parentId: string | null = parsed.data.parentId ?? null;
  if (parentId && !(await ownsDeck(userId, parentId))) {
    res.status(400).json({ error: "Parent deck not found" });
    return;
  }
  const [created] = await db
    .insert(flashcardDecksTable)
    .values({
      userId,
      name: parsed.data.name,
      subject: parsed.data.subject ?? "miscellaneous",
      color: parsed.data.color ?? "blue",
      description: parsed.data.description ?? "",
      parentId,
    })
    .returning();
  res.json(serializeDeck(created));
});

router.put("/flashcard-decks/:id", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const id = String(req.params["id"]);
  const parsed = UpdateDeckBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid deck body" });
    return;
  }
  const update: Partial<typeof flashcardDecksTable.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.subject !== undefined) update.subject = parsed.data.subject;
  if (parsed.data.color !== undefined) update.color = parsed.data.color;
  if (parsed.data.description !== undefined) update.description = parsed.data.description;
  if (parsed.data.parentId !== undefined) {
    if (parsed.data.parentId === null) {
      update.parentId = null;
    } else {
      if (!(await ownsDeck(userId, parsed.data.parentId))) {
        res.status(400).json({ error: "Parent deck not found" });
        return;
      }
      if (await wouldCreateCycle(userId, id, parsed.data.parentId)) {
        res.status(400).json({ error: "Cannot move a deck into itself or one of its subdecks" });
        return;
      }
      update.parentId = parsed.data.parentId;
    }
  }
  const [updated] = await db
    .update(flashcardDecksTable)
    .set(update)
    .where(and(eq(flashcardDecksTable.id, id), eq(flashcardDecksTable.userId, userId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }
  res.json(serializeDeck(updated));
});

router.delete("/flashcard-decks/:id", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const id = String(req.params["id"]);
  const [deleted] = await db
    .delete(flashcardDecksTable)
    .where(and(eq(flashcardDecksTable.id, id), eq(flashcardDecksTable.userId, userId)))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }
  res.json({ success: true });
});

// ───────────────────────── Cards ─────────────────────────

const CreateCardBody = z.object({
  deckId: z.string().min(1),
  type: z.enum(ALLOWED_TYPES).optional(),
  front: z.string(),
  back: z.string().optional(),
  tags: z.string().optional(),
});

const UpdateCardBody = z.object({
  type: z.enum(ALLOWED_TYPES).optional(),
  front: z.string().optional(),
  back: z.string().optional(),
  tags: z.string().optional(),
  suspended: z.number().int().min(0).max(1).optional(),
  // Move the card into a different (sub)deck. Ownership is checked at write time.
  deckId: z.string().min(1).optional(),
});

async function ownsDeck(userId: string, deckId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: flashcardDecksTable.id })
    .from(flashcardDecksTable)
    .where(and(eq(flashcardDecksTable.id, deckId), eq(flashcardDecksTable.userId, userId)))
    .limit(1);
  return !!row;
}

router.get("/flashcards", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const deckId = req.query["deckId"] ? String(req.query["deckId"]) : null;
  const includeSubdecks = req.query["includeSubdecks"] === "1" || req.query["includeSubdecks"] === "true";

  let deckIds: string[] | null = null;
  if (deckId) {
    if (includeSubdecks) {
      deckIds = await expandDeckSubtree(userId, deckId);
      if (deckIds.length === 0) { res.json({ cards: [] }); return; }
    } else {
      deckIds = [deckId];
    }
  }

  const where = deckIds
    ? and(eq(flashcardsTable.userId, userId), inArray(flashcardsTable.deckId, deckIds))
    : eq(flashcardsTable.userId, userId);
  const rows = await db
    .select()
    .from(flashcardsTable)
    .where(where)
    .orderBy(desc(flashcardsTable.createdAt));
  res.json({ cards: rows.map(serializeCard) });
});

router.get("/flashcards/search", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const q = String(req.query["q"] ?? "").trim();
  if (q.length < 2) { res.json({ results: [] }); return; }

  const allDecks = await db
    .select({ id: flashcardDecksTable.id, name: flashcardDecksTable.name, parentId: flashcardDecksTable.parentId })
    .from(flashcardDecksTable)
    .where(eq(flashcardDecksTable.userId, userId));

  const deckMap = new Map(allDecks.map(d => [d.id, d]));

  function getDeckPath(deckId: string): string[] {
    const path: string[] = [];
    let current = deckMap.get(deckId);
    let guard = 0;
    while (current && guard++ < 20) {
      path.unshift(current.name);
      current = current.parentId ? deckMap.get(current.parentId) : undefined;
    }
    return path;
  }

  const term = `%${q}%`;
  const cards = await db
    .select()
    .from(flashcardsTable)
    .where(and(
      eq(flashcardsTable.userId, userId),
      or(ilike(flashcardsTable.front, term), ilike(flashcardsTable.back, term)),
    ))
    .limit(50)
    .orderBy(desc(flashcardsTable.updatedAt));

  const results = cards.map(c => ({
    ...serializeCard(c),
    breadcrumb: getDeckPath(c.deckId),
  }));

  res.json({ results });
});

router.post("/flashcards", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const parsed = CreateCardBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid card body" });
    return;
  }
  if (!(await ownsDeck(userId, parsed.data.deckId))) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }
  const [created] = await db
    .insert(flashcardsTable)
    .values({
      userId,
      deckId: parsed.data.deckId,
      type: parsed.data.type ?? "basic",
      front: parsed.data.front,
      back: parsed.data.back ?? "",
      tags: parsed.data.tags ?? "",
    })
    .returning();
  res.json(serializeCard(created));
});

router.put("/flashcards/:id", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const id = String(req.params["id"]);
  const parsed = UpdateCardBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid card body" });
    return;
  }
  const update: Partial<typeof flashcardsTable.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.type !== undefined) update.type = parsed.data.type;
  if (parsed.data.front !== undefined) update.front = parsed.data.front;
  if (parsed.data.back !== undefined) update.back = parsed.data.back;
  if (parsed.data.tags !== undefined) update.tags = parsed.data.tags;
  if (parsed.data.suspended !== undefined) update.suspended = parsed.data.suspended;
  if (parsed.data.deckId !== undefined) {
    if (!(await ownsDeck(userId, parsed.data.deckId))) {
      res.status(400).json({ error: "Target deck not found" });
      return;
    }
    update.deckId = parsed.data.deckId;
  }
  const [updated] = await db
    .update(flashcardsTable)
    .set(update)
    .where(and(eq(flashcardsTable.id, id), eq(flashcardsTable.userId, userId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Card not found" });
    return;
  }
  res.json(serializeCard(updated));
});

router.delete("/flashcards/:id", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const id = String(req.params["id"]);
  const [deleted] = await db
    .delete(flashcardsTable)
    .where(and(eq(flashcardsTable.id, id), eq(flashcardsTable.userId, userId)))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Card not found" });
    return;
  }
  res.json({ success: true });
});

// ───────────────────────── Review (SM-2) ─────────────────────────

const ReviewBody = z.object({
  rating: z.number().int().min(1).max(4),
  durationMs: z.number().int().min(0).max(10 * 60 * 1000).optional(),
  // Local-day key the client computed (avoids server-vs-user TZ drift).
  dateKey: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/**
 * Improved SM-2+ scheduler.
 *
 * Key improvements over vanilla SM-2:
 *  - Learning steps: Again→10 min, Hard→1 day (caps re-show bleeding)
 *  - Good on first rep → 1d, second → 4d, then ease-driven
 *  - Easy on first rep → 4d, second → 10d, then ease*1.3
 *  - Interval fuzz (±5 %) prevents card "bunching" on the same future day
 *  - Ease floor 1.3, ceiling 3.5; fine-grained adjustments per rating
 *  - Lapse penalty scales with lapses (leech protection)
 *
 * Schema fields are identical — no migration required.
 */
function nextSchedule(card: typeof flashcardsTable.$inferSelect, rating: 1 | 2 | 3 | 4) {
  let interval = card.interval;
  let ease = Math.min(3.5, Math.max(1.3, card.ease || 2.5));
  let reps = card.reps;
  let lapses = card.lapses;

  if (rating === 1) {
    // Again: reset to learning, extra ease penalty scales with lapse count
    reps = 0;
    interval = 0;
    const lapsePenalty = Math.min(0.4, 0.2 + lapses * 0.01);
    ease = Math.max(1.3, ease - lapsePenalty);
    lapses += 1;
  } else if (rating === 2) {
    // Hard: small interval bump, ease drop
    if (reps === 0) interval = 1;
    else interval = Math.max(1, interval * 1.2);
    ease = Math.max(1.3, ease - 0.15);
    reps += 1;
  } else if (rating === 3) {
    // Good: standard SM-2 steps
    if (reps === 0) interval = 1;
    else if (reps === 1) interval = 4;
    else interval = interval * ease;
    // Ease is unchanged on Good (unlike vanilla SM-2 which drifts down)
    reps += 1;
  } else {
    // Easy: bigger jump, ease bonus
    if (reps === 0) interval = 4;
    else if (reps === 1) interval = 10;
    else interval = interval * ease * 1.3;
    ease = Math.min(3.5, ease + 0.15);
    reps += 1;
  }

  // Apply ±5 % fuzz to spread cards across adjacent days (avoid bunching).
  // Only applies to intervals longer than 2 days.
  if (interval > 2) {
    const fuzz = 1 + (Math.random() * 0.1 - 0.05);
    interval = Math.max(1, interval * fuzz);
  }

  const dueAt = new Date();
  if (rating === 1) {
    dueAt.setMinutes(dueAt.getMinutes() + 10);
  } else {
    dueAt.setMinutes(dueAt.getMinutes() + Math.round(interval * 24 * 60));
  }
  return { interval, ease, reps, lapses, dueAt };
}

router.post("/flashcards/:id/review", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const id = String(req.params["id"]);
  const parsed = ReviewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid review body" });
    return;
  }
  const [card] = await db
    .select()
    .from(flashcardsTable)
    .where(and(eq(flashcardsTable.id, id), eq(flashcardsTable.userId, userId)))
    .limit(1);
  if (!card) {
    res.status(404).json({ error: "Card not found" });
    return;
  }
  const sched = nextSchedule(card, parsed.data.rating as 1 | 2 | 3 | 4);
  const dateKey = parsed.data.dateKey ?? new Date().toISOString().slice(0, 10);

  await db.transaction(async (tx) => {
    await tx
      .update(flashcardsTable)
      .set({
        interval: sched.interval,
        ease: sched.ease,
        reps: sched.reps,
        lapses: sched.lapses,
        dueAt: sched.dueAt,
        updatedAt: new Date(),
      })
      .where(eq(flashcardsTable.id, id));
    await tx.insert(flashcardReviewsTable).values({
      userId,
      cardId: id,
      deckId: card.deckId,
      rating: parsed.data.rating,
      durationMs: parsed.data.durationMs ?? 0,
      dateKey,
    });
  });

  const [updated] = await db
    .select()
    .from(flashcardsTable)
    .where(eq(flashcardsTable.id, id))
    .limit(1);
  res.json(serializeCard(updated));
});

// ───────────────────────── Stats ─────────────────────────

/**
 * Per-day aggregated review stats. Used by the Calendar / Stats views to
 * fold flashcard activity into the same daily timeline as revision sessions.
 *
 * Query params: ?from=YYYY-MM-DD&to=YYYY-MM-DD (both optional).
 */
router.get("/flashcards/daily-stats", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const from = typeof req.query["from"] === "string" ? req.query["from"] : null;
  const to = typeof req.query["to"] === "string" ? req.query["to"] : null;
  const conditions = [eq(flashcardReviewsTable.userId, userId)];
  if (from) conditions.push(gte(flashcardReviewsTable.dateKey, from));
  if (to) conditions.push(lte(flashcardReviewsTable.dateKey, to));
  const rows = await db
    .select({
      dateKey: flashcardReviewsTable.dateKey,
      reviews: sql<number>`count(*)::int`,
      durationMs: sql<number>`coalesce(sum(${flashcardReviewsTable.durationMs}), 0)::bigint`,
      again: sql<number>`sum(case when ${flashcardReviewsTable.rating} = 1 then 1 else 0 end)::int`,
      hard: sql<number>`sum(case when ${flashcardReviewsTable.rating} = 2 then 1 else 0 end)::int`,
      good: sql<number>`sum(case when ${flashcardReviewsTable.rating} = 3 then 1 else 0 end)::int`,
      easy: sql<number>`sum(case when ${flashcardReviewsTable.rating} = 4 then 1 else 0 end)::int`,
    })
    .from(flashcardReviewsTable)
    .where(and(...conditions))
    .groupBy(flashcardReviewsTable.dateKey);
  // Drizzle returns bigint-as-string for sum(bigint). Coerce to number.
  res.json({
    days: rows.map((r) => ({
      dateKey: r.dateKey,
      reviews: r.reviews,
      durationMs: Number(r.durationMs),
      again: r.again,
      hard: r.hard,
      good: r.good,
      easy: r.easy,
    })),
  });
});

/**
 * Overall + per-deck weakness analytics. Returns the shape consumed by
 * `FlashcardsStatsSection` on the Stats page:
 *   {
 *     totalCards, totalReviews, retentionRate, avgEase, totalDurationMs,
 *     reviewsByRating: { again, hard, good, easy },
 *     decks: [{ id, name, subject, total, lapseRate, avgEase, reviews }],
 *     weakCards: [{ id, deckId, deckName, front, reps, lapses, ease, lapseRate }],
 *   }
 *
 * Reviews are summarised over the last `days` (default 90) so that recent
 * performance dominates the picture. Card-level fields (totalCards, avgEase,
 * weakCards) reflect the user's current library, not the window.
 */
router.get("/flashcards/analytics", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const days = Math.max(1, Math.min(365, Number(req.query["days"]) || 90));
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Reviews summary in window.
  const [totalsRow] = await db
    .select({
      reviews: sql<number>`count(*)::int`,
      durationMs: sql<number>`coalesce(sum(${flashcardReviewsTable.durationMs}), 0)::bigint`,
      again: sql<number>`sum(case when ${flashcardReviewsTable.rating} = 1 then 1 else 0 end)::int`,
      hard:  sql<number>`sum(case when ${flashcardReviewsTable.rating} = 2 then 1 else 0 end)::int`,
      good:  sql<number>`sum(case when ${flashcardReviewsTable.rating} = 3 then 1 else 0 end)::int`,
      easy:  sql<number>`sum(case when ${flashcardReviewsTable.rating} = 4 then 1 else 0 end)::int`,
    })
    .from(flashcardReviewsTable)
    .where(
      and(
        eq(flashcardReviewsTable.userId, userId),
        gte(flashcardReviewsTable.reviewedAt, since),
      ),
    );
  const totalReviews = totalsRow?.reviews ?? 0;
  const again = totalsRow?.again ?? 0;
  const hard = totalsRow?.hard ?? 0;
  const good = totalsRow?.good ?? 0;
  const easy = totalsRow?.easy ?? 0;
  const retentionRate = totalReviews > 0 ? (good + easy) / totalReviews : 0;

  // Card-level totals across the user's library.
  const [cardTotals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      avgEase: sql<number>`coalesce(avg(${flashcardsTable.ease}), 0)::float`,
    })
    .from(flashcardsTable)
    .where(eq(flashcardsTable.userId, userId));
  const totalCards = cardTotals?.total ?? 0;
  const avgEase = Number(cardTotals?.avgEase ?? 0);

  // Per-deck stats: deck metadata + card count + avg ease + recent reviews/lapseRate.
  const deckRows = await db
    .select({
      id: flashcardDecksTable.id,
      name: flashcardDecksTable.name,
      subject: flashcardDecksTable.subject,
    })
    .from(flashcardDecksTable)
    .where(eq(flashcardDecksTable.userId, userId));
  const deckCardStats = await db
    .select({
      deckId: flashcardsTable.deckId,
      total: sql<number>`count(*)::int`,
      avgEase: sql<number>`coalesce(avg(${flashcardsTable.ease}), 0)::float`,
    })
    .from(flashcardsTable)
    .where(eq(flashcardsTable.userId, userId))
    .groupBy(flashcardsTable.deckId);
  const cardStatsMap = new Map(deckCardStats.map((d) => [d.deckId, d]));
  const deckReviewStats = await db
    .select({
      deckId: flashcardReviewsTable.deckId,
      reviews: sql<number>`count(*)::int`,
      again: sql<number>`sum(case when ${flashcardReviewsTable.rating} = 1 then 1 else 0 end)::int`,
    })
    .from(flashcardReviewsTable)
    .where(
      and(
        eq(flashcardReviewsTable.userId, userId),
        gte(flashcardReviewsTable.reviewedAt, since),
      ),
    )
    .groupBy(flashcardReviewsTable.deckId);
  const reviewStatsMap = new Map(deckReviewStats.map((d) => [d.deckId, d]));

  const decks = deckRows
    .map((d) => {
      const cs = cardStatsMap.get(d.id);
      const rs = reviewStatsMap.get(d.id);
      const reviews = rs?.reviews ?? 0;
      return {
        id: d.id,
        name: d.name,
        subject: d.subject,
        total: cs?.total ?? 0,
        avgEase: Number(cs?.avgEase ?? 0),
        reviews,
        lapseRate: reviews > 0 ? (rs!.again / reviews) : 0,
      };
    })
    // Hide empty decks from the dashboard list.
    .filter((d) => d.total > 0 || d.reviews > 0);

  // Weakest cards: highest lapse rate after at least 3 reviews.
  const weakRows = await db
    .select({
      id: flashcardsTable.id,
      deckId: flashcardsTable.deckId,
      front: flashcardsTable.front,
      lapses: flashcardsTable.lapses,
      reps: flashcardsTable.reps,
      ease: flashcardsTable.ease,
    })
    .from(flashcardsTable)
    .where(eq(flashcardsTable.userId, userId))
    .orderBy(desc(flashcardsTable.lapses), sql`${flashcardsTable.ease} asc`)
    .limit(50);
  const deckNameMap = new Map(deckRows.map((d) => [d.id, d.name]));
  const weakCards = weakRows
    .filter((c) => c.lapses > 0 && c.reps >= 3)
    .map((c) => ({
      id: c.id,
      deckId: c.deckId,
      deckName: deckNameMap.get(c.deckId) ?? "(deleted deck)",
      front: c.front.slice(0, 200),
      lapses: c.lapses,
      reps: c.reps,
      ease: c.ease,
      lapseRate: c.reps > 0 ? c.lapses / Math.max(c.reps, c.lapses) : 0,
    }))
    .sort((a, b) => b.lapseRate - a.lapseRate)
    .slice(0, 20);

  res.json({
    totalCards,
    totalReviews,
    retentionRate,
    avgEase,
    totalDurationMs: Number(totalsRow?.durationMs ?? 0),
    reviewsByRating: { again, hard, good, easy },
    decks,
    weakCards,
    windowDays: days,
  });
});

// ───────────────────────── Import ─────────────────────────

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "should", "could", "may", "might", "can", "of", "to", "in", "on", "at",
  "by", "for", "with", "about", "against", "between", "into", "through",
  "during", "before", "after", "above", "below", "from", "up", "down", "out",
  "over", "under", "again", "further", "then", "once", "here", "there", "when",
  "where", "why", "how", "all", "any", "both", "each", "few", "more", "most",
  "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so",
  "than", "too", "very", "this", "that", "these", "those", "i", "you", "he",
  "she", "it", "we", "they", "them", "his", "her", "its", "our", "their",
  "as", "if", "while", "because", "until", "also", "just",
]);

/**
 * Auto-cloze: pick up to 3 keyword tokens (length > 3, not stopwords) and
 * wrap each in `{{c1::word}}`. Picks deterministically for short text and
 * randomly for long text so users don't always get the same blanks.
 */
function autoCloze(text: string, max = 3): string {
  const tokens: { word: string; start: number; end: number }[] = [];
  const re = /[A-Za-z][A-Za-z\-']{2,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const w = m[0];
    if (w.length <= 3) continue;
    if (STOPWORDS.has(w.toLowerCase())) continue;
    tokens.push({ word: w, start: m.index, end: m.index + w.length });
  }
  if (tokens.length === 0) return text;

  // Sample without replacement.
  const pool = [...tokens];
  const picks: typeof tokens = [];
  while (picks.length < max && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    picks.push(pool.splice(idx, 1)[0]);
  }
  picks.sort((a, b) => a.start - b.start);

  let out = "";
  let cursor = 0;
  picks.forEach((p, i) => {
    out += text.slice(cursor, p.start);
    out += `{{c${i + 1}::${p.word}}}`;
    cursor = p.end;
  });
  out += text.slice(cursor);
  return out;
}

type ParsedCard = ApkgCard;

function parseCsvOrTsv(text: string): ParsedCard[] {
  // Detect delimiter: tabs win if any line has them, else commas, else lone
  // semicolons. Anki's text exports default to tab.
  const delim = text.includes("\t") ? "\t" : text.includes(";") ? ";" : ",";
  const cards: ParsedCard[] = [];
  // Very small CSV-ish parser: handles quoted fields with embedded delimiters
  // and escaped quotes ("") but does NOT support embedded newlines (rare in
  // exports and would require a much heavier parser).
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const fields: string[] = [];
    let i = 0;
    let cur = "";
    let inQuote = false;
    while (i < line.length) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 2; continue; }
        if (ch === '"') { inQuote = false; i++; continue; }
        cur += ch; i++;
      } else {
        if (ch === '"' && cur === "") { inQuote = true; i++; continue; }
        if (ch === delim) { fields.push(cur); cur = ""; i++; continue; }
        cur += ch; i++;
      }
    }
    fields.push(cur);
    const front = (fields[0] ?? "").trim();
    const back = (fields[1] ?? "").trim();
    const tags = (fields[2] ?? "").trim();
    if (!front) continue;
    const isCloze = /\{\{c\d+::/.test(front);
    cards.push({
      type: isCloze ? "cloze" : "basic",
      front,
      back,
      tags,
    });
  }
  return cards;
}

router.post(
  "/flashcard-decks/:id/import",
  upload.single("file"),
  async (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const deckId = String(req.params["id"]);
    if (!(await ownsDeck(userId, deckId))) {
      res.status(404).json({ error: "Deck not found" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    const filename = req.file.originalname.toLowerCase();
    let parsed: ParsedCard[];
    try {
      if (filename.endsWith(".apkg")) {
        parsed = await parseApkg(req.file.buffer);
      } else {
        parsed = parseCsvOrTsv(req.file.buffer.toString("utf8"));
      }
    } catch (err) {
      req.log.error({ err }, "flashcard import parse failed");
      res.status(400).json({ error: "Could not parse file" });
      return;
    }
    if (parsed.length === 0) {
      res.status(400).json({ error: "No flashcards found in file" });
      return;
    }
    // Dedupe within import on (front,back) so users can re-upload safely.
    const seen = new Set<string>();
    const fresh = parsed.filter((c) => {
      const k = c.front + "\u0001" + c.back;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    // Cap import size.
    const MAX = 5000;
    const slice = fresh.slice(0, MAX);
    const inserted = await db
      .insert(flashcardsTable)
      .values(
        slice.map((c) => ({
          userId,
          deckId,
          type: c.type,
          front: c.front,
          back: c.back,
          tags: c.tags,
        })),
      )
      .returning({ id: flashcardsTable.id });
    res.json({
      created: inserted.length,
      truncatedTo: slice.length < fresh.length ? MAX : null,
    });
  },
);

// Auto-cloze suggestion endpoint — called from the editor.
router.post("/flashcards/auto-cloze", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const text = typeof req.body?.text === "string" ? req.body.text : "";
  if (!text.trim()) {
    res.status(400).json({ error: "Empty text" });
    return;
  }
  res.json({ text: autoCloze(text, 3) });
});

// Bulk delete / reset endpoints used by the deck UI.
router.post("/flashcard-decks/:id/reset", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const id = String(req.params["id"]);
  if (!(await ownsDeck(userId, id))) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }
  // Reset SR state without deleting cards.
  await db
    .update(flashcardsTable)
    .set({ interval: 0, ease: 2.5, reps: 0, lapses: 0, dueAt: new Date() })
    .where(and(eq(flashcardsTable.userId, userId), eq(flashcardsTable.deckId, id)));
  res.json({ success: true });
});

// Fetch the cards that are due *right now* in a deck (or across all decks).
// When a deckId is supplied we also pull cards from all of its subdecks so
// "Study now" on a parent deck reviews the entire subtree.
router.get("/flashcards/due", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const deckId = req.query["deckId"] ? String(req.query["deckId"]) : null;
  const limit = Math.max(1, Math.min(500, Number(req.query["limit"]) || 50));
  const conditions = [
    eq(flashcardsTable.userId, userId),
    eq(flashcardsTable.suspended, 0),
    lte(flashcardsTable.dueAt, new Date()),
  ];
  if (deckId) {
    const ids = await expandDeckSubtree(userId, deckId);
    if (ids.length === 0) { res.json({ cards: [] }); return; }
    conditions.push(inArray(flashcardsTable.deckId, ids));
  }
  const rows = await db
    .select()
    .from(flashcardsTable)
    .where(and(...conditions))
    .orderBy(flashcardsTable.dueAt)
    .limit(limit);
  res.json({ cards: rows.map(serializeCard) });
});

// Restore a card to a previous SR state and delete the most recent review
// row for it (the one we want to undo). Used by the study UI's "Back" button.
const RestoreStateBody = z.object({
  interval: z.number().min(0),
  ease: z.number().min(1.0).max(5.0),
  reps: z.number().int().min(0),
  lapses: z.number().int().min(0),
  dueAt: z.string().min(1),
});
router.post("/flashcards/:id/restore-state", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const id = String(req.params["id"]);
  const parsed = RestoreStateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid restore body" });
    return;
  }
  const dueAt = new Date(parsed.data.dueAt);
  if (Number.isNaN(dueAt.getTime())) {
    res.status(400).json({ error: "Invalid dueAt" });
    return;
  }
  await db.transaction(async (tx) => {
    await tx
      .update(flashcardsTable)
      .set({
        interval: parsed.data.interval,
        ease: parsed.data.ease,
        reps: parsed.data.reps,
        lapses: parsed.data.lapses,
        dueAt,
        updatedAt: new Date(),
      })
      .where(and(eq(flashcardsTable.id, id), eq(flashcardsTable.userId, userId)));
    // Delete only the most recent review row for this card+user, so undoing
    // can't wipe earlier history.
    const [latest] = await tx
      .select({ id: flashcardReviewsTable.id })
      .from(flashcardReviewsTable)
      .where(and(eq(flashcardReviewsTable.cardId, id), eq(flashcardReviewsTable.userId, userId)))
      .orderBy(desc(flashcardReviewsTable.reviewedAt))
      .limit(1);
    if (latest) {
      await tx.delete(flashcardReviewsTable).where(eq(flashcardReviewsTable.id, latest.id));
    }
  });
  res.json({ success: true });
});

// Delete a set of cards by id.
router.post("/flashcards/bulk-delete", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  if (ids.length === 0) {
    res.json({ deleted: 0 });
    return;
  }
  const result = await db
    .delete(flashcardsTable)
    .where(and(eq(flashcardsTable.userId, userId), inArray(flashcardsTable.id, ids)))
    .returning({ id: flashcardsTable.id });
  res.json({ deleted: result.length });
});

export default router;
