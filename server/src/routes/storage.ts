import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import multer from "multer";
import {
  RequestUploadUrlBody,
} from "../shared/api";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

/**
 * POST /storage/uploads/upload
 *
 * Multipart upload endpoint — client sends the file directly to the server,
 * server streams it to Cloudflare R2. Avoids any CORS issues with R2.
 */
router.post(
  "/storage/uploads/upload",
  (req: Request, res: Response, next) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  },
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file provided" });
        return;
      }

      const { originalname, mimetype, buffer } = req.file;
      const { objectPath } = await objectStorageService.uploadObject(
        buffer,
        mimetype,
        originalname,
      );

      res.json({ objectPath });
    } catch (error) {
      req.log.error({ err: error }, "Error uploading file");
      res.status(500).json({ error: "Failed to upload file" });
    }
  },
);

/**
 * POST /storage/uploads/request-url
 *
 * Kept for backward compatibility — now returns a server-side upload URL
 * instead of a presigned R2 URL (avoids CORS).
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;
    const reservedPath = objectStorageService.reserveObjectPath();

    res.json({
      uploadURL: null,
      objectPath: reservedPath,
      useDirectUpload: true,
      metadata: { name, size, contentType },
    });
  } catch (error) {
    req.log.error({ err: error }, "Error reserving object path");
    res.status(500).json({ error: "Failed to reserve object path" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Stream an object from R2 for authenticated users.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

/**
 * GET /storage/public-objects/*
 * Kept for compatibility.
 */
router.get("/storage/public-objects/*filePath", async (_req: Request, res: Response) => {
  res.status(404).json({ error: "File not found" });
});

export default router;
