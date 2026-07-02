// R2-compatible local adapter using the filesystem for local development.
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { ReadableStream } from "stream/web";

export const DEFAULT_R2_ROOT = join(process.cwd(), ".wrangler", "r2-local");

interface R2Object {
  key: string;
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
}

interface R2ListResult {
  objects: { key: string }[];
}

export class R2BucketAdapter {
  private root: string;

  constructor(root?: string) {
    this.root = root ?? DEFAULT_R2_ROOT;
    mkdirSync(this.root, { recursive: true });
  }

  async put(key: string, data: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<void> {
    const filePath = join(this.root, key);
    mkdirSync(dirname(filePath), { recursive: true });

    const metadataPath = filePath + ".meta.json";
    writeFileSync(filePath, Buffer.from(data));
    writeFileSync(metadataPath, JSON.stringify(options?.httpMetadata ?? {}));
  }

  async get(key: string): Promise<R2Object | null> {
    const filePath = join(this.root, key);
    const metadataPath = filePath + ".meta.json";

    if (!existsSync(filePath)) return null;
    // Directories are not files — treat as missing
    if (statSync(filePath).isDirectory()) return null;

    const body = readFileSync(filePath);
    const httpMetadata = existsSync(metadataPath)
      ? JSON.parse(readFileSync(metadataPath, "utf-8"))
      : undefined;

    // Convert Buffer to ReadableStream
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(body);
        controller.close();
      },
    });

    return { key, body: stream, httpMetadata };
  }

  async delete(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key];
    for (const k of keys) {
      const filePath = join(this.root, k);
      const metadataPath = filePath + ".meta.json";
      try {
        if (existsSync(filePath)) rmSync(filePath);
        if (existsSync(metadataPath)) rmSync(metadataPath);
      } catch { /* ignore */ }
    }
  }

  async list(options?: { prefix?: string }): Promise<R2ListResult> {
    const prefix = options?.prefix ?? "";
    const baseDir = join(this.root, prefix);

    if (!existsSync(dirname(baseDir))) return { objects: [] };

    // Recursively walk the prefix directory
    const objects: { key: string }[] = [];
    this._walk(this.root, prefix, objects);
    return { objects };
  }

  private _walk(root: string, prefix: string, objects: { key: string }[]) {
    const startDir = join(root, prefix);
    if (!existsSync(startDir)) return;

    const entries = readdirSync(startDir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.name.endsWith(".meta.json")) continue;
      const fullPath = join(root, relPath);
      if (entry.isDirectory()) {
        this._walk(root, relPath, objects);
      } else if (existsSync(fullPath)) {
        objects.push({ key: relPath });
      }
    }
  }
}
