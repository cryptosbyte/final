import { Router, type IRouter, type Request, type Response } from "express";
import { db, notebooksTable, photosTable } from "../db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

const router: IRouter = Router();

const ALLOWED_TAGS = ["maths", "biology", "chemistry", "miscellaneous"] as const;
const ALLOWED_COLORS = [
  "blue",
  "green",
  "red",
  "amber",
  "purple",
  "pink",
  "teal",
  "slate",
  "orange",
  "indigo",
] as const;

const CreateNotebookBody = z.object({
  title: z.string().trim().min(1).max(200),
  tag: z.enum(ALLOWED_TAGS).optional(),
  color: z.enum(ALLOWED_COLORS).optional(),
  content: z.string().optional(),
  isPublic: z.boolean().optional(),
});

const UpdateNotebookBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  tag: z.enum(ALLOWED_TAGS).optional(),
  color: z.enum(ALLOWED_COLORS).optional(),
  content: z.string().optional(),
  isPublic: z.boolean().optional(),
});

function requireAuth(req: Request, res: Response): string | null {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return req.user.id;
}

function serialize(n: typeof notebooksTable.$inferSelect) {
  return {
    id: n.id,
    title: n.title,
    tag: n.tag,
    color: n.color,
    content: n.content,
    isPublic: n.isPublic,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}

const PHOTO_REF_REGEX = /\/api\/photos\/public\/([0-9a-f-]{8,})/gi;
function extractPhotoIds(content: string): string[] {
  const ids = new Set<string>();
  for (const m of content.matchAll(PHOTO_REF_REGEX)) {
    if (m[1]) ids.add(m[1]);
  }
  return Array.from(ids);
}

/**
 * Sync the privacy of every photo embedded in this notebook so it matches
 * the notebook's own visibility. Only photos owned by `userId` are touched —
 * we never silently flip a different user's photo to public/private.
 */
async function syncEmbeddedPhotoPrivacy(userId: string, content: string, isPublic: boolean) {
  const ids = extractPhotoIds(content);
  if (ids.length === 0) return;
  await db
    .update(photosTable)
    .set({ isPublic })
    .where(and(eq(photosTable.userId, userId), inArray(photosTable.id, ids)));
}

router.get("/notebooks", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const rows = await db
    .select()
    .from(notebooksTable)
    .where(eq(notebooksTable.userId, userId))
    .orderBy(desc(notebooksTable.updatedAt));
  res.json({ notebooks: rows.map(serialize) });
});

router.get("/notebooks/:id", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const id = String(req.params["id"]);
  const [row] = await db
    .select()
    .from(notebooksTable)
    .where(and(eq(notebooksTable.id, id), eq(notebooksTable.userId, userId)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Notebook not found" });
    return;
  }
  res.json(serialize(row));
});

/**
 * GET /notebooks/public/:id
 *
 * No-auth public read. Returns the notebook ONLY if its owner has marked it
 * public. The `userId` is intentionally omitted from the response.
 */
router.get("/notebooks/public/:id", async (req: Request, res: Response) => {
  const id = String(req.params["id"]);
  const [row] = await db
    .select()
    .from(notebooksTable)
    .where(eq(notebooksTable.id, id))
    .limit(1);
  if (!row || !row.isPublic) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json(serialize(row));
});

router.post("/notebooks", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const parsed = CreateNotebookBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid notebook body" });
    return;
  }
  const [created] = await db
    .insert(notebooksTable)
    .values({
      userId,
      title: parsed.data.title,
      tag: parsed.data.tag ?? "miscellaneous",
      color: parsed.data.color ?? "blue",
      content: parsed.data.content ?? "",
      isPublic: parsed.data.isPublic ?? false,
    })
    .returning();
  res.json(serialize(created));
});

router.put("/notebooks/:id", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const id = String(req.params["id"]);
  const parsed = UpdateNotebookBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid notebook body" });
    return;
  }
  const update: Partial<typeof notebooksTable.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.title !== undefined) update.title = parsed.data.title;
  if (parsed.data.tag !== undefined) update.tag = parsed.data.tag;
  if (parsed.data.color !== undefined) update.color = parsed.data.color;
  if (parsed.data.content !== undefined) update.content = parsed.data.content;
  if (parsed.data.isPublic !== undefined) update.isPublic = parsed.data.isPublic;

  const [updated] = await db
    .update(notebooksTable)
    .set(update)
    .where(and(eq(notebooksTable.id, id), eq(notebooksTable.userId, userId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Notebook not found" });
    return;
  }

  // Mirror notebook visibility onto every embedded photo owned by the user.
  await syncEmbeddedPhotoPrivacy(userId, updated.content, updated.isPublic);

  res.json(serialize(updated));
});

router.delete("/notebooks/:id", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const id = String(req.params["id"]);
  const [deleted] = await db
    .delete(notebooksTable)
    .where(and(eq(notebooksTable.id, id), eq(notebooksTable.userId, userId)))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Notebook not found" });
    return;
  }
  res.json({ success: true });
});

export default router;
