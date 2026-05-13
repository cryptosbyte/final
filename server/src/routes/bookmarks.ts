import { Router, type IRouter, type Request, type Response } from "express";
import { db, bookmarksTable } from "../db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/bookmarks", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId: string = req.user.id;

  const rows = await db
    .select()
    .from(bookmarksTable)
    .where(eq(bookmarksTable.userId, userId))
    .limit(1);

  const bookmarks = rows[0]?.bookmarks ?? [];
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.json({ bookmarks });
});

router.put("/bookmarks", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId: string = req.user.id;
  const { bookmarks } = req.body as { bookmarks?: unknown };

  if (!Array.isArray(bookmarks)) {
    res.status(400).json({ error: "bookmarks must be an array" });
    return;
  }

  await db
    .insert(bookmarksTable)
    .values({
      userId,
      bookmarks,
    })
    .onConflictDoUpdate({
      target: bookmarksTable.userId,
      set: {
        bookmarks,
        updatedAt: new Date(),
      },
    });

  res.json({ success: true });
});

export default router;
