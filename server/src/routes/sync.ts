import { Router, type IRouter, type Request, type Response } from "express";
import { db, userSyncStateTable } from "../db";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";

const router: IRouter = Router();

function requireAuth(req: Request, res: Response): string | null {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return req.user.id;
}

router.get("/sync/state", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const [row] = await db
    .select()
    .from(userSyncStateTable)
    .where(eq(userSyncStateTable.userId, userId))
    .limit(1);
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.json({
    dominantDeviceId: row?.dominantDeviceId ?? null,
    dominantDeviceLabel: row?.dominantDeviceLabel ?? null,
    dominantSyncedAt: row?.dominantSyncedAt?.toISOString() ?? null,
  });
});

const ClaimBody = z.object({
  deviceId: z.string().min(1).max(120),
  label: z.string().max(120).optional(),
});

router.post("/sync/claim", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const parsed = ClaimBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid claim body" });
    return;
  }
  const now = new Date();
  await db
    .insert(userSyncStateTable)
    .values({
      userId,
      dominantDeviceId: parsed.data.deviceId,
      dominantDeviceLabel: parsed.data.label ?? null,
      dominantSyncedAt: now,
    })
    .onConflictDoUpdate({
      target: userSyncStateTable.userId,
      set: {
        dominantDeviceId: parsed.data.deviceId,
        dominantDeviceLabel: parsed.data.label ?? null,
        dominantSyncedAt: now,
      },
    });
  res.json({
    dominantDeviceId: parsed.data.deviceId,
    dominantDeviceLabel: parsed.data.label ?? null,
    dominantSyncedAt: now.toISOString(),
  });
});

export default router;
