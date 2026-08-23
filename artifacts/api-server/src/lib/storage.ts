/**
 * File storage layer (product spec 12.1).
 *
 * Three backends, selected by environment, with a clean abstraction:
 *  - Backblaze B2 S3-compatible storage: enabled when B2_KEY_ID,
 *    B2_APPLICATION_KEY and B2_BUCKET_NAME are set. B2 is preferred when
 *    configured because it is the Gallery's configured cloud store.
 *  - Cloudflare R2 (10 GB free, zero egress): enabled when R2_ACCOUNT_ID,
 *    R2_ACCESS_KEY, R2_SECRET_KEY and R2_BUCKET are all set.
 *  - Local disk under `<repo root>/data/files/`: the fallback that runs until
 *    cloud keys exist, so the app works out of the box.
 *
 * Metadata (kind, name, mime, size, owner, storage key) lives in the separate
 * files database via the `files` table; blobs live in the store. The serve
 * route is GET /api/files/:key (see routes/files.ts).
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { filesDb, files } from "@workspace/db";

export type FileKind = "image" | "document" | "audio" | "build-app" | "code";
export type FileOwner = "user" | "infinity" | "account";

export interface FileBlob {
  key: string;
  data: Buffer;
  contentType?: string;
}

export interface FileStorage {
  put(key: string, data: Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<{ data: Buffer; contentType?: string } | null>;
  remove(key: string): Promise<void>;
}

/** Walk up from the server CWD to the repo root (pnpm-workspace.yaml anchor). */
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const LOCAL_ROOT = path.join(findRepoRoot(), "data", "files");

/** Strip any path-traversal or unsafe characters from a storage key. */
function safeKey(key: string): string {
  return key
    .replace(/\.\./g, "")
    .replace(/[^a-zA-Z0-9._/ -]/g, "_")
    .replace(/^\/+/, "");
}

class LocalDiskStorage implements FileStorage {
  async put(key: string, data: Buffer, _contentType?: string): Promise<void> {
    const p = path.join(LOCAL_ROOT, safeKey(key));
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data);
  }

  async get(key: string): Promise<{ data: Buffer; contentType?: string } | null> {
    const p = path.join(LOCAL_ROOT, safeKey(key));
    try {
      const data = await readFile(p);
      const st = await stat(p);
      return { data, contentType: undefined };
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(path.join(LOCAL_ROOT, safeKey(key)));
    } catch {
      // Already gone, nothing to do.
    }
  }
}

class B2Storage implements FileStorage {
  private client: S3Client;
  private bucket: string;

  constructor(bucket: string) {
    const region = process.env["B2_REGION"] || "eu-central-003";
    const endpoint = process.env["B2_ENDPOINT"] || `https://s3.${region}.backblazeb2.com`;
    this.bucket = bucket;
    this.client = new S3Client({
      region,
      endpoint,
      credentials: {
        accessKeyId: process.env["B2_KEY_ID"] ?? "",
        secretAccessKey: process.env["B2_APPLICATION_KEY"] ?? "",
      },
      // B2 accepts standard S3 path-style addressing reliably across regions.
      forcePathStyle: true,
    });
  }

  async put(key: string, data: Buffer, contentType?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: safeKey(key),
        Body: data,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<{ data: Buffer; contentType?: string } | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }),
      );
      if (!res.Body) return null;
      const data = Buffer.from(await res.Body.transformToByteArray());
      return { data, contentType: res.ContentType };
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
    } catch {
      // Already gone, nothing to do.
    }
  }
}

class R2Storage implements FileStorage {
  private client: S3Client;
  private bucket: string;

  constructor(bucket: string) {
    this.bucket = bucket;
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env["R2_ACCOUNT_ID"]}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env["R2_ACCESS_KEY"] ?? "",
        secretAccessKey: process.env["R2_SECRET_KEY"] ?? "",
      },
    });
  }

  async put(key: string, data: Buffer, contentType?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: safeKey(key),
        Body: data,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<{ data: Buffer; contentType?: string } | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }),
      );
      if (!res.Body) return null;
      const data = Buffer.from(await res.Body.transformToByteArray());
      return { data, contentType: res.ContentType };
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
    } catch {
      // Already gone, nothing to do.
    }
  }
}

let cachedStorage: FileStorage | null = null;

/** Pick the storage backend from the environment: B2, then R2, else local disk. */
export function getStorage(): FileStorage {
  if (!cachedStorage) {
    const b2Bucket = process.env["B2_BUCKET_NAME"];
    if (process.env["B2_KEY_ID"] && process.env["B2_APPLICATION_KEY"] && b2Bucket) {
      cachedStorage = new B2Storage(b2Bucket);
    } else {
      const r2Bucket = process.env["R2_BUCKET"];
      if (
        process.env["R2_ACCOUNT_ID"] &&
        process.env["R2_ACCESS_KEY"] &&
        process.env["R2_SECRET_KEY"] &&
        r2Bucket
      ) {
        cachedStorage = new R2Storage(r2Bucket);
      } else {
        cachedStorage = new LocalDiskStorage();
      }
    }
  }
  return cachedStorage;
}

/** Which backend is active: "b2", "r2", or "local". */
export function storageBackend(): "b2" | "r2" | "local" {
  return getStorage() instanceof B2Storage ? "b2" : getStorage() instanceof R2Storage ? "r2" : "local";
}

const MIME_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "audio/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/ogg": ".ogg",
  "video/webm": ".webm",
  "video/mp4": ".mp4",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/csv": ".csv",
  "application/json": ".json",
};

function extForMime(mime?: string): string {
  if (!mime) return "";
  return MIME_EXT[mime.toLowerCase()] ?? "";
}

function inferKind(mime?: string): FileKind {
  if (!mime) return "document";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/") || mime.startsWith("video/")) return "audio";
  if (mime === "application/zip" || mime.includes("compressed")) return "build-app";
  return "document";
}

export interface PersistFileOptions {
  data: Buffer;
  mimeType?: string;
  name?: string;
  kind?: FileKind;
  conversationId?: string | null;
  owner?: FileOwner;
}

export interface PersistedFile {
  key: string;
  url: string;
  fileId: string | null;
}

/**
 * Store a blob and record its metadata in the files database. Never throws:
 * metadata insert failures (DB down) still leave the blob safely on disk/R2.
 */
export async function persistFile(opts: PersistFileOptions): Promise<PersistedFile | null> {
  try {
    const kind = opts.kind ?? inferKind(opts.mimeType);
    const now = new Date();
    const month = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const key = `${kind}/${month}/${randomUUID()}${extForMime(opts.mimeType)}`;

    const storage = getStorage();
    await storage.put(key, opts.data, opts.mimeType);

    let fileId: string | null = null;
    try {
      const [row] = await filesDb
        .insert(files)
        .values({
          conversationId: opts.conversationId ?? null,
          kind,
          name: (opts.name ?? `file${extForMime(opts.mimeType)}`).slice(0, 255),
          mime: opts.mimeType ?? "application/octet-stream",
          size: opts.data.length,
          storageKey: key,
          bucket: storageBackend(),
          owner: opts.owner ?? "user",
        })
        .returning();
      fileId = row.id;
    } catch (err) {
      console.error("[storage] metadata insert failed (blob still stored):", err instanceof Error ? err.message : err);
    }

    return { key, url: `/api/files/${encodeURIComponent(key)}`, fileId };
  } catch (err) {
    console.error("[storage] persistFile failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
