import { Router, type IRouter, type Request, type Response } from "express";
import { db, revisionDataTable } from "../db";
import { eq, and } from "drizzle-orm";

const router: IRouter = Router();

router.get("/revision", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId: string = req.user.id;

  const rows = await db
    .select()
    .from(revisionDataTable)
    .where(eq(revisionDataTable.userId, userId));

  const data: Record<string, unknown> = {};
  for (const row of rows) {
    data[row.date] = row.data;
  }

  res.json({ data });
});

router.put("/revision/:date", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const date: string = String(req.params["date"]);
  const userId: string = req.user.id;
  const { entry } = req.body as { entry?: unknown };

  if (!date || !entry) {
    res.status(400).json({ error: "Missing date or entry" });
    return;
  }

  await db
    .insert(revisionDataTable)
    .values({
      userId,
      date,
      data: entry,
    })
    .onConflictDoUpdate({
      target: [revisionDataTable.userId, revisionDataTable.date],
      set: {
        data: entry,
        updatedAt: new Date(),
      },
    });

  res.json({ success: true });
});

router.delete("/revision/:date", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const date: string = String(req.params["date"]);
  const userId: string = req.user.id;

  await db
    .delete(revisionDataTable)
    .where(
      and(
        eq(revisionDataTable.userId, userId),
        eq(revisionDataTable.date, date),
      ),
    );

  res.json({ success: true });
});

export default router;
