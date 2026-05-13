import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { db, foldersTable, photosTable } from "../db";
import { and, eq, isNull, desc, gte } from "drizzle-orm";
import {
  CreateFolderBody,
  RenameFolderBody,
  CreatePhotoBody,
  UpdatePhotoBody,
} from "../shared/api";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";

const objectStorageService = new ObjectStorageService();

const router: IRouter = Router();

const UNDO_WINDOW_MS = 5 * 60 * 1000;

function requireAuth(req: Request, res: Response): string | null {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return req.user.id;
}

function serializePhoto(p: typeof photosTable.$inferSelect) {
  return {
    id: p.id,
    folderId: p.folderId,
    name: p.name,
    objectPath: p.objectPath,
    contentType: p.contentType,
    size: p.size,
    uploadedAt: p.uploadedAt.toISOString(),
    deletedAt: p.deletedAt ? p.deletedAt.toISOString() : null,
    isPublic: p.isPublic,
  };
}

function serializeFolder(f: typeof foldersTable.$inferSelect) {
  return {
    id: f.id,
    name: f.name,
    createdAt: f.createdAt.toISOString(),
  };
}

// ---------- Folders ----------

router.get("/folders", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const rows = await db
    .select()
    .from(foldersTable)
    .where(eq(foldersTable.userId, userId))
    .orderBy(desc(foldersTable.createdAt));
  res.json({ folders: rows.map(serializeFolder) });
});

router.post("/folders", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const parsed = CreateFolderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid folder body" });
    return;
  }
  const [created] = await db
    .insert(foldersTable)
    .values({ userId, name: parsed.data.name.trim() })
    .returning();
  res.json(serializeFolder(created));
});

router.put("/folders/:id", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const id = String(req.params["id"]);
  const parsed = RenameFolderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid folder body" });
    return;
  }
  const [updated] = await db
    .update(foldersTable)
    .set({ name: parsed.data.name.trim() })
    .where(and(eq(foldersTable.id, id), eq(foldersTable.userId, userId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }
  res.json(serializeFolder(updated));
});

router.delete("/folders/:id", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const id = String(req.params["id"]);
  // Set photos in this folder to null folder; then delete folder.
  await db
    .update(photosTable)
    .set({ folderId: null })
    .where(and(eq(photosTable.folderId, id), eq(photosTable.userId, userId)));
  await db
    .delete(foldersTable)
    .where(and(eq(foldersTable.id, id), eq(foldersTable.userId, userId)));
  res.json({ success: true });
});

// ---------- Photos ----------

router.get("/photos", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const folderId = typeof req.query["folderId"] === "string" ? req.query["folderId"] : null;
  const wantAll = req.query["all"] === "1" || req.query["all"] === "true";
  const conditions = [
    eq(photosTable.userId, userId),
    isNull(photosTable.deletedAt),
  ];
  if (!wantAll) {
    conditions.push(folderId ? eq(photosTable.folderId, folderId) : isNull(photosTable.folderId));
  }
  const rows = await db
    .select()
    .from(photosTable)
    .where(and(...conditions))
    .orderBy(desc(photosTable.uploadedAt));
  res.json({ photos: rows.map(serializePhoto) });
});

router.get("/photos/recently-deleted", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const cutoff = new Date(Date.now() - UNDO_WINDOW_MS);
  const rows = await db
    .select()
    .from(photosTable)
    .where(
      and(
        eq(photosTable.userId, userId),
        gte(photosTable.deletedAt, cutoff),
      ),
    )
    .orderBy(desc(photosTable.deletedAt));
  res.json({ photos: rows.map(serializePhoto) });
});

router.post("/photos", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const parsed = CreatePhotoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid photo body" });
    return;
  }
  const { folderId, name, objectPath, contentType, size } = parsed.data;

  // Verify folder ownership when provided.
  if (folderId) {
    const [folder] = await db
      .select()
      .from(foldersTable)
      .where(and(eq(foldersTable.id, folderId), eq(foldersTable.userId, userId)))
      .limit(1);
    if (!folder) {
      res.status(400).json({ error: "Invalid folder" });
      return;
    }
  }

  // Validate objectPath shape — must be a "/objects/<uuid-ish>" entity path
  // produced by our presigned upload flow. Reject anything else to stop a
  // malicious client from registering arbitrary storage paths against their
  // user (which they could then mark public).
  if (!/^\/objects\/[A-Za-z0-9_\-/.]{8,}$/.test(objectPath)) {
    res.status(400).json({ error: "Invalid object path" });
    return;
  }
  try {
    const [created] = await db
      .insert(photosTable)
      .values({
        userId,
        folderId: folderId ?? null,
        name: name.trim(),
        objectPath,
        contentType,
        size,
      })
      .returning();
    res.json(serializePhoto(created));
  } catch (err) {
    // Unique constraint on objectPath: another (or the same) user has already
    // claimed this object — we refuse to let it be re-registered, which would
    // otherwise allow path-theft into a public-shared photo record.
    req.log.warn({ err }, "Photo registration rejected (duplicate object path?)");
    res.status(409).json({ error: "This object has already been registered." });
  }
});

router.put("/photos/:id", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const id = String(req.params["id"]);
  // Pull out our extension fields BEFORE the strict zod parse so the generated
  // schema doesn't reject them.
  const isPublicRaw = (req.body && typeof req.body === "object")
    ? (req.body as Record<string, unknown>)["isPublic"]
    : undefined;
  const bodyForParse = (req.body && typeof req.body === "object")
    ? Object.fromEntries(Object.entries(req.body as Record<string, unknown>).filter(([k]) => k !== "isPublic"))
    : req.body;
  const parsed = UpdatePhotoBody.safeParse(bodyForParse);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid update body" });
    return;
  }
  const update: Partial<typeof photosTable.$inferInsert> = {};
  if (typeof isPublicRaw === "boolean") update.isPublic = isPublicRaw;
  if (parsed.data.name !== undefined) update.name = parsed.data.name.trim();
  if (parsed.data.folderId !== undefined) {
    if (parsed.data.folderId) {
      const [folder] = await db
        .select()
        .from(foldersTable)
        .where(and(eq(foldersTable.id, parsed.data.folderId), eq(foldersTable.userId, userId)))
        .limit(1);
      if (!folder) {
        res.status(400).json({ error: "Invalid folder" });
        return;
      }
      update.folderId = parsed.data.folderId;
    } else {
      update.folderId = null;
    }
  }
  const [updated] = await db
    .update(photosTable)
    .set(update)
    .where(and(eq(photosTable.id, id), eq(photosTable.userId, userId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  res.json(serializePhoto(updated));
});

router.delete("/photos/:id", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const id = String(req.params["id"]);
  const [updated] = await db
    .update(photosTable)
    .set({ deletedAt: new Date() })
    .where(and(eq(photosTable.id, id), eq(photosTable.userId, userId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  res.json({ success: true });
});

router.post("/photos/:id/restore", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const id = String(req.params["id"]);
  const cutoff = new Date(Date.now() - UNDO_WINDOW_MS);
  const [photo] = await db
    .select()
    .from(photosTable)
    .where(and(eq(photosTable.id, id), eq(photosTable.userId, userId)))
    .limit(1);
  if (!photo) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  if (!photo.deletedAt) {
    res.json(serializePhoto(photo));
    return;
  }
  if (photo.deletedAt < cutoff) {
    res.status(410).json({ error: "Undo window expired" });
    return;
  }
  const [updated] = await db
    .update(photosTable)
    .set({ deletedAt: null })
    .where(and(eq(photosTable.id, id), eq(photosTable.userId, userId)))
    .returning();
  res.json(serializePhoto(updated));
});

/**
 * GET /photos/public/:id
 *
 * Streams a photo via a stable, share-friendly URL. Access rules:
 *   - If the photo is marked `isPublic=true`, anyone may fetch it (CDN-style).
 *   - Otherwise, only the authenticated owner may fetch it. This makes the
 *     same embed URL work inside private notebooks (owner reads via session)
 *     and inside published public notebooks (anyone reads via flag).
 *
 * Security:
 *   - We only forward image content-types. Non-image MIME types are rejected
 *     so an attacker cannot publish HTML/JS that executes under our origin.
 *   - `X-Content-Type-Options: nosniff` prevents browser MIME sniffing.
 *   - Soft-deleted photos are never served.
 */
router.get("/photos/public/:id", async (req: Request, res: Response) => {
  const id = String(req.params["id"]);
  try {
    const [photo] = await db
      .select()
      .from(photosTable)
      .where(eq(photosTable.id, id))
      .limit(1);
    if (!photo || photo.deletedAt) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const isOwner = req.isAuthenticated() && req.user.id === photo.userId;
    if (!photo.isPublic && !isOwner) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!photo.contentType.startsWith("image/")) {
      // Hard refuse to serve non-image content over a same-origin "public" URL.
      // Active content (HTML/SVG-with-script/JS) under our origin would inherit
      // session context and is not what this endpoint is for.
      res.status(415).json({ error: "Unsupported media type" });
      return;
    }
    const objectFile = await objectStorageService.getObjectEntityFile(photo.objectPath);
    const response = await objectStorageService.downloadObject(objectFile);
    res.status(response.status);
    // Forward only safe headers; pin our own content-type from the DB record.
    const passthroughHeaders = ["content-length", "etag", "last-modified", "accept-ranges"];
    response.headers.forEach((value, key) => {
      if (passthroughHeaders.includes(key.toLowerCase())) res.setHeader(key, value);
    });
    res.setHeader("Content-Type", photo.contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${photo.name.replace(/[^\w.\- ]/g, "_")}"`,
    );
    // Public photos can be cached aggressively; private (owner-only) responses
    // must not be cached by shared caches.
    res.setHeader(
      "Cache-Control",
      photo.isPublic ? "public, max-age=3600" : "private, max-age=0, must-revalidate",
    );
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving public photo");
    res.status(500).json({ error: "Failed to serve photo" });
  }
});

export default router;
