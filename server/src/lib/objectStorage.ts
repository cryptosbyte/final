import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  NotFound,
} from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";

function getR2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing Cloudflare R2 credentials. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY environment variables."
    );
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

function getBucketName(): string {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) {
    throw new Error("R2_BUCKET_NAME environment variable is not set.");
  }
  return bucket;
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  reserveObjectPath(): string {
    const objectKey = `uploads/${randomUUID()}`;
    return this.normalizeObjectEntityPath(objectKey);
  }

  async uploadObject(
    buffer: Buffer,
    contentType: string,
    _originalName: string,
  ): Promise<{ objectPath: string }> {
    const client = getR2Client();
    const bucket = getBucketName();
    const objectKey = `uploads/${randomUUID()}`;

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: buffer,
        ContentType: contentType,
      }),
    );

    return { objectPath: this.normalizeObjectEntityPath(objectKey) };
  }

  normalizeObjectEntityPath(objectKey: string): string {
    return `/objects/${objectKey}`;
  }

  objectKeyFromEntityPath(objectPath: string): string {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    return objectPath.slice("/objects/".length);
  }

  async getObjectEntityFile(objectPath: string): Promise<{ key: string; bucket: string }> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const key = this.objectKeyFromEntityPath(objectPath);
    const bucket = getBucketName();
    const client = getR2Client();

    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    } catch (err: any) {
      if (
        err instanceof NotFound ||
        err?.name === "NotFound" ||
        err?.$metadata?.httpStatusCode === 404
      ) {
        throw new ObjectNotFoundError();
      }
      throw err;
    }

    return { key, bucket };
  }

  async downloadObject(
    file: { key: string; bucket: string },
    cacheTtlSec: number = 3600,
  ): Promise<Response> {
    const client = getR2Client();

    const headCmd = new HeadObjectCommand({ Bucket: file.bucket, Key: file.key });
    const head = await client.send(headCmd);

    const getCmd = new GetObjectCommand({ Bucket: file.bucket, Key: file.key });
    const obj = await client.send(getCmd);

    const contentType = head.ContentType || "application/octet-stream";
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": `private, max-age=${cacheTtlSec}`,
    };
    if (head.ContentLength !== undefined) {
      headers["Content-Length"] = String(head.ContentLength);
    }

    const body = obj.Body;
    if (!body) {
      return new Response(null, { headers });
    }

    const webStream = body.transformToWebStream();
    return new Response(webStream, { headers });
  }
}
