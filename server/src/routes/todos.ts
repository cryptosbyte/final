import { Router, type IRouter, type Request, type Response } from "express";
import { db, todosTable } from "../db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/todos", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId: string = req.user.id;

  const rows = await db
    .select()
    .from(todosTable)
    .where(eq(todosTable.userId, userId))
    .limit(1);

  const todos = rows[0]?.todos ?? [];
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.json({ todos });
});

router.put("/todos", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId: string = req.user.id;
  const { todos } = req.body as { todos?: unknown };

  if (!Array.isArray(todos)) {
    res.status(400).json({ error: "todos must be an array" });
    return;
  }

  await db
    .insert(todosTable)
    .values({
      userId,
      todos,
    })
    .onConflictDoUpdate({
      target: todosTable.userId,
      set: {
        todos,
        updatedAt: new Date(),
      },
    });

  res.json({ success: true });
});

export default router;
