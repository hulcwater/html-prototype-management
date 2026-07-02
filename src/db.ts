import type { Module, Prototype, UploadRecord } from "./types";

// ── Modules ──────────────────────────────────────────────────────────────────

export async function listModules(db: D1Database) {
  const modules = await db
    .prepare(
      `SELECT m.id, m.name, m.sort_order, m.created_at,
              COUNT(p.id) AS prototype_count
       FROM modules m
       LEFT JOIN prototypes p ON p.module_id = m.id
       GROUP BY m.id
       ORDER BY m.sort_order ASC, m.created_at ASC`
    )
    .all<Module & { prototype_count: number }>();
  const total = await db
    .prepare("SELECT COUNT(*) AS n FROM prototypes")
    .first<{ n: number }>();
  return { modules: modules.results, total: total?.n ?? 0 };
}

export async function getModule(db: D1Database, id: number) {
  return db.prepare("SELECT * FROM modules WHERE id = ?").bind(id).first<Module>();
}

export async function getModuleByName(db: D1Database, name: string) {
  return db.prepare("SELECT * FROM modules WHERE name = ?").bind(name).first<Module>();
}

export async function createModule(db: D1Database, name: string) {
  const result = await db
    .prepare("INSERT INTO modules (name, created_at) VALUES (?, datetime('now')) RETURNING *")
    .bind(name)
    .first<Module>();
  return result!;
}

export async function updateModule(db: D1Database, id: number, name: string) {
  await db.prepare("UPDATE modules SET name = ? WHERE id = ?").bind(name, id).run();
  return getModule(db, id);
}

export async function deleteModule(db: D1Database, id: number) {
  await db.prepare("DELETE FROM modules WHERE id = ?").bind(id).run();
}

export async function reorderModules(db: D1Database, ids: number[]) {
  const stmts = ids.map((id, i) =>
    db.prepare("UPDATE modules SET sort_order = ? WHERE id = ?").bind(i, id)
  );
  await db.batch(stmts);
}

// ── Prototypes ────────────────────────────────────────────────────────────────

export async function listPrototypes(db: D1Database, moduleId?: number) {
  const sql = moduleId
    ? `SELECT p.*, m.name AS module_name,
              (SELECT COUNT(*) FROM upload_records WHERE prototype_id = p.id) AS record_count
       FROM prototypes p JOIN modules m ON m.id = p.module_id
       WHERE p.module_id = ?
       ORDER BY p.updated_at DESC`
    : `SELECT p.*, m.name AS module_name,
              (SELECT COUNT(*) FROM upload_records WHERE prototype_id = p.id) AS record_count
       FROM prototypes p JOIN modules m ON m.id = p.module_id
       ORDER BY p.updated_at DESC`;
  const result = moduleId
    ? await db.prepare(sql).bind(moduleId).all<Prototype & { record_count: number }>()
    : await db.prepare(sql).all<Prototype & { record_count: number }>();
  return result.results;
}

export async function getPrototype(db: D1Database, id: number) {
  return db
    .prepare(
      `SELECT p.*, m.name AS module_name FROM prototypes p
       JOIN modules m ON m.id = p.module_id WHERE p.id = ?`
    )
    .bind(id)
    .first<Prototype>();
}

export async function getPrototypeByPreviewId(db: D1Database, previewId: string) {
  return db
    .prepare(
      `SELECT p.*, m.name AS module_name FROM prototypes p
       JOIN modules m ON m.id = p.module_id WHERE p.preview_id = ?`
    )
    .bind(previewId)
    .first<Prototype>();
}

export async function createPrototype(
  db: D1Database,
  name: string,
  moduleId: number,
  description: string,
  previewId: string
) {
  const result = await db
    .prepare(
      `INSERT INTO prototypes (name, module_id, description, preview_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now')) RETURNING *`
    )
    .bind(name, moduleId, description, previewId)
    .first<Prototype>();
  return result!;
}

export async function updatePrototype(
  db: D1Database,
  id: number,
  name: string,
  description: string,
  moduleId: number
) {
  await db
    .prepare(
      `UPDATE prototypes SET name = ?, description = ?, module_id = ?,
       updated_at = datetime('now') WHERE id = ?`
    )
    .bind(name, description, moduleId, id)
    .run();
  return getPrototype(db, id);
}

export async function touchPrototype(db: D1Database, id: number) {
  await db
    .prepare("UPDATE prototypes SET updated_at = datetime('now') WHERE id = ?")
    .bind(id)
    .run();
}

export async function deletePrototype(db: D1Database, id: number) {
  await db.prepare("DELETE FROM prototypes WHERE id = ?").bind(id).run();
}

// ── Upload Records ────────────────────────────────────────────────────────────

export async function listRecords(db: D1Database, prototypeId: number) {
  const result = await db
    .prepare(
      "SELECT * FROM upload_records WHERE prototype_id = ? ORDER BY upload_time DESC"
    )
    .bind(prototypeId)
    .all<UploadRecord>();
  return result.results;
}

export async function getLatestRecord(db: D1Database, prototypeId: number) {
  return db
    .prepare(
      "SELECT * FROM upload_records WHERE prototype_id = ? ORDER BY upload_time DESC LIMIT 1"
    )
    .bind(prototypeId)
    .first<UploadRecord>();
}

export async function createRecord(
  db: D1Database,
  prototypeId: number,
  fileName: string,
  r2Key: string,
  fileSize: number,
  fileType: string,
  uploader: string,
  updateNotes: string
) {
  const result = await db
    .prepare(
      `INSERT INTO upload_records
       (prototype_id, file_name, r2_key, file_size, file_type, uploader, update_notes, upload_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now')) RETURNING *`
    )
    .bind(prototypeId, fileName, r2Key, fileSize, fileType, uploader, updateNotes)
    .first<UploadRecord>();
  return result!;
}

export async function trimRecords(db: D1Database, prototypeId: number, keep = 10) {
  const old = await db
    .prepare(
      `SELECT id, r2_key FROM upload_records WHERE prototype_id = ?
       ORDER BY upload_time DESC LIMIT -1 OFFSET ?`
    )
    .bind(prototypeId, keep)
    .all<{ id: number; r2_key: string }>();
  return old.results;
}

export async function deleteRecord(db: D1Database, id: number) {
  await db.prepare("DELETE FROM upload_records WHERE id = ?").bind(id).run();
}

export async function getRecord(db: D1Database, id: number) {
  return db
    .prepare("SELECT * FROM upload_records WHERE id = ?")
    .bind(id)
    .first<UploadRecord>();
}
