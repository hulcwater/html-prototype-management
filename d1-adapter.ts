// D1-compatible SQLite adapter using sql.js for local development.
// Mirrors the Cloudflare D1Database / D1PreparedStatement interfaces.
import initSqlJs, { type Database as SqlJsDatabase, type Statement as SqlJsStatement } from "sql.js";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";

export class D1Statement {
  private params: any[] = [];

  constructor(
    private db: SqlJsDatabase,
    private sql: string,
  ) {}

  bind(...params: any[]): this {
    this.params = params;
    return this;
  }

  async all<T = unknown>(): Promise<{ results: T[]; success: true }> {
    const stmt = this.db.prepare(this.sql);
    try {
      if (this.params.length > 0) stmt.bind(this.params);
      const results: T[] = [];
      while (stmt.step()) results.push(stmt.getAsObject() as unknown as T);
      return { results, success: true };
    } finally {
      stmt.free();
    }
  }

  async first<T = unknown>(): Promise<T | null> {
    const stmt = this.db.prepare(this.sql);
    try {
      if (this.params.length > 0) stmt.bind(this.params);
      if (stmt.step()) return stmt.getAsObject() as unknown as T;
      return null;
    } finally {
      stmt.free();
    }
  }

  async run(): Promise<{ success: true }> {
    const stmt = this.db.prepare(this.sql);
    try {
      if (this.params.length > 0) stmt.bind(this.params);
      stmt.step();
      return { success: true };
    } finally {
      stmt.free();
    }
  }
}

export class D1DatabaseAdapter {
  constructor(private db: SqlJsDatabase) {}

  prepare(sql: string): D1Statement {
    return new D1Statement(this.db, sql);
  }

  async batch(stmts: D1Statement[]): Promise<unknown[]> {
    // Execute each statement in order; the real D1 batch returns results
    const out: unknown[] = [];
    for (const s of stmts) {
      out.push(await s.all());
    }
    return out;
  }

  async exec(sql: string): Promise<void> {
    this.db.run(sql);
  }

  saveToFile(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from(this.db.export()));
  }
}

let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

export async function createD1Adapter(dbPath: string): Promise<D1DatabaseAdapter> {
  if (!SQL) SQL = await initSqlJs();

  let db: SqlJsDatabase;
  if (existsSync(dbPath)) {
    db = new SQL.Database(readFileSync(dbPath));
  } else {
    db = new SQL.Database();
  }
  return new D1DatabaseAdapter(db);
}
