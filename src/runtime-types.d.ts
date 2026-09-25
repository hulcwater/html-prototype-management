type D1Result = {
  success: boolean;
  meta?: { changes?: number };
};

type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = unknown>(): Promise<{ results: T[]; success: boolean }>;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<D1Result>;
};

declare interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
  exec(query: string): Promise<unknown>;
}

type R2Object = {
  key: string;
  body: ReadableStream<Uint8Array>;
  httpMetadata?: { contentType?: string };
};

type R2ListOptions = {
  prefix?: string;
};

type R2ListResult = {
  objects: R2Object[];
};

declare interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
  put(key: string, value: ArrayBuffer | ArrayBufferView | string | ReadableStream<Uint8Array>, options?: unknown): Promise<void>;
  delete(key: string | string[]): Promise<void>;
  list(options?: R2ListOptions): Promise<R2ListResult>;
}

declare interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
