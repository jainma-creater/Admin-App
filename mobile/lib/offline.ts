import * as SQLite from 'expo-sqlite';
import { api, getErrorMessage } from './api';

const DB_NAME = 'branch-visit-offline.db';

let db: SQLite.SQLiteDatabase | null = null;

export async function initOfflineDB(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;

  db = await SQLite.openDatabaseAsync(DB_NAME);

  await db.execAsync(`
    PRAGMA journal_mode = WAL;
  `);
  // NOTE: foreign_keys must stay OFF. Queue rows (photos, checklist items,
  // actions) reference SERVER visit ids — the visit usually does not exist in
  // the local pending_visits table, and enforcing the FK made every offline
  // photo save crash with "FOREIGN KEY constraint failed".

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS pending_visits (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL,
      visit_type_id TEXT NOT NULL,
      template_id TEXT,
      scheduled_date TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      assignee_id TEXT,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      synced_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS pending_checklist_items (
      id TEXT PRIMARY KEY,
      visit_id TEXT NOT NULL,
      checklist_item_id TEXT NOT NULL,
      response TEXT,
      remark TEXT,
      photo_uris TEXT,
      is_ok INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      synced_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS pending_photos (
      id TEXT PRIMARY KEY,
      visit_id TEXT NOT NULL,
      checklist_item_id TEXT,
      asset_id TEXT,
      it_asset_row_id TEXT,
      uri TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      uploaded INTEGER NOT NULL DEFAULT 0,
      upload_url TEXT,
      created_at TEXT NOT NULL,
      synced_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS pending_actions (
      id TEXT PRIMARY KEY,
      visit_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      assignee_id TEXT,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      synced_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS cached_checklists (
      visit_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      saved_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pending_visits_status ON pending_visits(status);
    CREATE INDEX IF NOT EXISTS idx_pending_checklist_visit ON pending_checklist_items(visit_id);
    CREATE INDEX IF NOT EXISTS idx_pending_photos_visit ON pending_photos(visit_id);
    CREATE INDEX IF NOT EXISTS idx_pending_actions_visit ON pending_actions(visit_id);
  `);

  // Lightweight schema migration for the local photo queue: old installs lack
  // the asset link columns / sync status columns added later. ALTER table
  // ADD COLUMN is enough and keeps existing queued rows intact.
  const photoCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(pending_photos)');
  const photoNames = new Set(photoCols.map((c) => c.name));
  if (!photoNames.has('asset_id')) {
    await db.execAsync(`ALTER TABLE pending_photos ADD COLUMN asset_id TEXT;`);
  }
  if (!photoNames.has('it_asset_row_id')) {
    await db.execAsync(`ALTER TABLE pending_photos ADD COLUMN it_asset_row_id TEXT;`);
  }
  if (!photoNames.has('sync_status')) {
    await db.execAsync(`ALTER TABLE pending_photos ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending';`);
    await db.execAsync(`ALTER TABLE pending_photos ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;`);
    await db.execAsync(`ALTER TABLE pending_photos ADD COLUMN last_error TEXT;`);
  }
  for (const t of ['pending_visits', 'pending_checklist_items', 'pending_actions']) {
    const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${t})`);
    const names = new Set(cols.map((c) => c.name));
    if (!names.has('sync_status')) {
      await db.execAsync(`ALTER TABLE ${t} ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending';`);
      await db.execAsync(`ALTER TABLE ${t} ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;`);
      await db.execAsync(`ALTER TABLE ${t} ADD COLUMN last_error TEXT;`);
    }
  }

  // Device identity for idempotent sync: stable per install, generated once.
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['device_id']);
  if (!row?.value) {
    const deviceId = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['device_id', deviceId]);
  }

  return db;
}

/** Stable per-install device identifier used for idempotent syncing
 *  (X-Device-Id header). Server dedupes on (device_id, client id). */
export async function getDeviceId(): Promise<string> {
  const database = await getOfflineDB();
  const row = await database.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['device_id']);
  return row?.value ?? 'dev-unknown';
}

export async function getOfflineDB(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    await initOfflineDB();
  }
  return db!;
}

export interface OfflineVisit {
  id: string;
  branch_id: string;
  visit_type_id: string;
  template_id?: string;
  scheduled_date?: string;
  status: string;
  assignee_id?: string;
  data: any;
  created_at: string;
  updated_at: string;
  synced_at?: string;
  sync_status?: string;
  retry_count?: number;
  last_error?: string;
}

export interface OfflineChecklistItem {
  id: string;
  visit_id: string;
  checklist_item_id: string;
  response?: string;
  remark?: string;
  photo_uris?: string;
  is_ok: number;
  created_at: string;
  updated_at: string;
  synced_at?: string;
  sync_status?: string;
  retry_count?: number;
  last_error?: string;
}

export interface OfflinePhoto {
  id: string;
  visit_id: string;
  checklist_item_id?: string;
  asset_id?: string;
  it_asset_row_id?: string;
  uri: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  uploaded: number;
  upload_url?: string;
  caption?: string;
  created_at: string;
  synced_at?: string;
  sync_status?: string;
  retry_count?: number;
  last_error?: string;
}

export interface OfflineAction {
  id: string;
  visit_id: string;
  title: string;
  description?: string;
  assignee_id?: string;
  due_date?: string;
  status: string;
  created_at: string;
  updated_at: string;
  synced_at?: string;
  sync_status?: string;
  retry_count?: number;
  last_error?: string;
}

export async function saveVisitOffline(visit: Omit<OfflineVisit, 'created_at' | 'updated_at'>): Promise<void> {
  const database = await getOfflineDB();
  const now = new Date().toISOString();
  
  await database.runAsync(
    `INSERT OR REPLACE INTO pending_visits 
     (id, branch_id, visit_type_id, template_id, scheduled_date, status, assignee_id, data, created_at, updated_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 
       COALESCE((SELECT created_at FROM pending_visits WHERE id = ?), ?),
       ?, 
       (SELECT synced_at FROM pending_visits WHERE id = ?))`,
    [
      visit.id, visit.branch_id, visit.visit_type_id, visit.template_id || null,
      visit.scheduled_date || null, visit.status, visit.assignee_id || null,
      JSON.stringify(visit.data), visit.id, now, visit.id, now, visit.id
    ]
  );
}

export async function getOfflineVisit(id: string): Promise<OfflineVisit | null> {
  const database = await getOfflineDB();
  const row = await database.getFirstAsync<OfflineVisit>(
    'SELECT * FROM pending_visits WHERE id = ?', [id]
  );
  return row || null;
}

export async function getOfflineVisits(status?: string): Promise<OfflineVisit[]> {
  const database = await getOfflineDB();
  if (status) {
    return database.getAllAsync<OfflineVisit>(
      'SELECT * FROM pending_visits WHERE status = ? ORDER BY updated_at DESC', [status]
    );
  }
  return database.getAllAsync<OfflineVisit>(
    'SELECT * FROM pending_visits ORDER BY updated_at DESC'
  );
}

export async function saveChecklistItemOffline(item: Omit<OfflineChecklistItem, 'created_at' | 'updated_at'>): Promise<void> {
  const database = await getOfflineDB();
  const now = new Date().toISOString();
  
  await database.runAsync(
    `INSERT OR REPLACE INTO pending_checklist_items
     (id, visit_id, checklist_item_id, response, remark, photo_uris, is_ok, created_at, updated_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?,
       COALESCE((SELECT created_at FROM pending_checklist_items WHERE id = ?), ?),
       ?,
       (SELECT synced_at FROM pending_checklist_items WHERE id = ?))`,
    [
      item.id, item.visit_id, item.checklist_item_id,
      item.response || null, item.remark || null, item.photo_uris || null,
      item.is_ok ? 1 : 0, item.id, now, item.id, now, item.id
    ]
  );
}

export async function getOfflineChecklistItems(visitId: string): Promise<OfflineChecklistItem[]> {
  const database = await getOfflineDB();
  return database.getAllAsync<OfflineChecklistItem>(
    'SELECT * FROM pending_checklist_items WHERE visit_id = ?', [visitId]
  );
}

export async function savePhotoOffline(photo: Omit<OfflinePhoto, 'created_at'>): Promise<void> {
  const database = await getOfflineDB();
  const now = new Date().toISOString();
  
  await database.runAsync(
    `INSERT OR REPLACE INTO pending_photos
     (id, visit_id, checklist_item_id, asset_id, it_asset_row_id, uri, file_name, mime_type, file_size, uploaded, upload_url, caption, created_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT synced_at FROM pending_photos WHERE id = ?))`,
    [
      photo.id, photo.visit_id, photo.checklist_item_id || null,
      photo.asset_id || null, photo.it_asset_row_id || null,
      photo.uri, photo.file_name, photo.mime_type, photo.file_size,
      photo.uploaded ? 1 : 0, photo.upload_url || null, photo.caption || null, now, photo.id
    ]
  );
}

export async function getOfflinePhotos(visitId: string): Promise<OfflinePhoto[]> {
  const database = await getOfflineDB();
  return database.getAllAsync<OfflinePhoto>(
    'SELECT * FROM pending_photos WHERE visit_id = ?', [visitId]
  );
}

export async function deleteOfflinePhoto(id: string): Promise<void> {
  const database = await getOfflineDB();
  await database.runAsync('DELETE FROM pending_photos WHERE id = ?', [id]);
}

export async function saveActionOffline(action: Omit<OfflineAction, 'created_at' | 'updated_at'>): Promise<void> {
  const database = await getOfflineDB();
  const now = new Date().toISOString();
  
  await database.runAsync(
    `INSERT OR REPLACE INTO pending_actions
     (id, visit_id, title, description, assignee_id, due_date, status, created_at, updated_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?,
       COALESCE((SELECT created_at FROM pending_actions WHERE id = ?), ?),
       ?,
       (SELECT synced_at FROM pending_actions WHERE id = ?))`,
    [
      action.id, action.visit_id, action.title, action.description || null,
      action.assignee_id || null, action.due_date || null, action.status,
      action.id, now, action.id, now, action.id
    ]
  );
}

export async function getOfflineActions(visitId: string): Promise<OfflineAction[]> {
  const database = await getOfflineDB();
  return database.getAllAsync<OfflineAction>(
    'SELECT * FROM pending_actions WHERE visit_id = ?', [visitId]
  );
}

const SYNCABLE_TABLES = new Set([
  'pending_visits',
  'pending_checklist_items',
  'pending_photos',
  'pending_actions',
]);

export async function markSynced(table: string, id: string): Promise<void> {
  if (!SYNCABLE_TABLES.has(table)) {
    throw new Error(`Unknown table for sync: ${table}`);
  }
  const database = await getOfflineDB();
  const now = new Date().toISOString();
  await database.runAsync(
    `UPDATE ${table} SET synced_at = ?, sync_status = 'synced', last_error = NULL WHERE id = ?`, [now, id]
  );
}

export async function markSyncFailed(table: string, id: string, error: string): Promise<void> {
  if (!SYNCABLE_TABLES.has(table)) {
    throw new Error(`Unknown table for sync: ${table}`);
  }
  const database = await getOfflineDB();
  await database.runAsync(
    `UPDATE ${table} SET sync_status = 'failed', retry_count = retry_count + 1, last_error = ? WHERE id = ?`,
    [error.slice(0, 500), id]
  );
}

/** Total unsynced rows (everything still waiting or failed). */
export async function getPendingSyncCount(): Promise<number> {
  const database = await getOfflineDB();
  let total = 0;
  for (const t of SYNCABLE_TABLES) {
    const row = await database.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM ${t} WHERE synced_at IS NULL`
    );
    total += row?.count || 0;
  }
  return total;
}

/** Per-table breakdown for the Pending Sync screen. */
export async function getSyncSummary(): Promise<{
  visits: { pending: number; failed: number };
  items: { pending: number; failed: number };
  photos: { pending: number; failed: number };
  actions: { pending: number; failed: number };
  errors: string[];
}> {
  const database = await getOfflineDB();
  const summary: any = { visits: { pending: 0, failed: 0 }, items: { pending: 0, failed: 0 }, photos: { pending: 0, failed: 0 }, actions: { pending: 0, failed: 0 }, errors: [] };
  const tables: Record<string, string> = {
    visits: 'pending_visits',
    items: 'pending_checklist_items',
    photos: 'pending_photos',
    actions: 'pending_actions',
  };
  for (const [key, t] of Object.entries(tables)) {
    const pending = await database.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM ${t} WHERE synced_at IS NULL AND (sync_status IS NULL OR sync_status IN ('pending', 'retrying'))`
    );
    const failed = await database.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM ${t} WHERE synced_at IS NULL AND sync_status = 'failed'`
    );
    summary[key].pending = pending?.count || 0;
    summary[key].failed = failed?.count || 0;
  }
  const errRows = await database.getAllAsync<{ last_error: string }>(
    `SELECT last_error FROM pending_visits WHERE sync_status = 'failed' AND last_error IS NOT NULL UNION ALL
     SELECT last_error FROM pending_checklist_items WHERE sync_status = 'failed' AND last_error IS NOT NULL UNION ALL
     SELECT last_error FROM pending_photos WHERE sync_status = 'failed' AND last_error IS NOT NULL UNION ALL
     SELECT last_error FROM pending_actions WHERE sync_status = 'failed' AND last_error IS NOT NULL LIMIT 20`
  );
  summary.errors = Array.from(new Set(errRows.map((r) => r.last_error)));
  return summary;
}

/** How long to wait (ms) before the next attempt of an item, by failure count. */
function backoffMs(retries: number): number {
  return Math.min(30000, 1000 * Math.pow(2, Math.min(retries, 5)));
}

export async function syncAll(): Promise<{ success: number; failed: number; errors: string[] }> {
  const database = await getOfflineDB();
  const errors: string[] = [];
  let success = 0;
  let failed = 0;
  const deviceId = await getDeviceId();

  // Sync editable visits (pre-submission states). SUBMITTED and later are
  // managed server-side, so there is nothing local to push for them.
  const unsyncedVisits = await database.getAllAsync<OfflineVisit>(
    'SELECT * FROM pending_visits WHERE synced_at IS NULL AND status IN (\'DRAFT\', \'ASSIGNED\', \'SCHEDULED\', \'IN_PROGRESS\')'
  );

  for (const visit of unsyncedVisits) {
    // Back off after repeated failures (server down, quota, etc.).
    if (visit.retry_count && visit.retry_count > 0 && Date.now() < (visit.updated_at ? new Date(visit.updated_at).getTime() : 0) + backoffMs(visit.retry_count)) {
      failed++;
      continue;
    }
    try {
      const items = await getOfflineChecklistItems(visit.id);
      const actions = await getOfflineActions(visit.id);

      const parsedVisit = JSON.parse(visit.data || '{}');
      const visitData = {
        ...parsedVisit,
        checklist_items: items.map(i => ({
          checklist_item_id: i.checklist_item_id,
          status: i.response,
          remark: i.remark,
          is_completed: i.is_ok === 1,
        })),
        corrective_actions: actions.map(a => ({
          title: a.title,
          description: a.description,
          assignee_id: a.assignee_id,
          due_date: a.due_date,
        })),
      };

      const idemHeaders = {
        'X-Device-Id': deviceId,
        'X-Idempotency-Key': visit.id,
      };

      // The visit may never have reached the server (whole visit done
      // offline). PATCH returns 404 then — create it first with an
      // idempotency key, then map the local id to the server id so photos
      // and children attach to the real record.
      try {
        if (visit.status === 'IN_PROGRESS') {
          await api.post(`/visits/${visit.id}/start`, {}, { headers: idemHeaders });
        }
        await api.patch(`/visits/${visit.id}`, visitData, { headers: idemHeaders });
      } catch (patchErr: any) {
        if (patchErr?.response?.status === 404) {
          const created = await api.post('/visits', {
            branch_id: visit.branch_id,
            visit_type_id: visit.visit_type_id,
            scheduled_date: visit.scheduled_date || null,
            instructions: parsedVisit.instructions,
          }, { headers: idemHeaders });
          const serverId = created.data?.id;
          if (serverId && serverId !== visit.id) {
            for (const t of ['pending_checklist_items', 'pending_photos', 'pending_actions']) {
              await database.runAsync(`UPDATE ${t} SET visit_id = ? WHERE visit_id = ?`, [serverId, visit.id]);
            }
            await database.runAsync('UPDATE pending_visits SET id = ? WHERE id = ?', [serverId, visit.id]);
            visit.id = serverId;
          }
          // Now push the full payload (incl. children) onto the created record.
          // Items/actions below are re-read for the (now remapped) visit.
        } else {
          throw patchErr;
        }
      }
      await api.patch(`/visits/${visit.id}`, visitData, { headers: idemHeaders });

      const itemsAfter = await getOfflineChecklistItems(visit.id);
      const actionsAfter = await getOfflineActions(visit.id);

      await markSynced('pending_visits', visit.id);
      for (const item of itemsAfter) await markSynced('pending_checklist_items', item.id);
      for (const action of actionsAfter) await markSynced('pending_actions', action.id);
      success++;
    } catch (e: any) {
      failed++;
      const msg = `Visit ${visit.id}: ${await getErrorMessage(e)}`;
      errors.push(msg);
      await markSyncFailed('pending_visits', visit.id, msg);
    }
  }

  // Sync pending photos
  const unsyncedPhotos = await database.getAllAsync<OfflinePhoto>(
    'SELECT * FROM pending_photos WHERE synced_at IS NULL'
  );

  for (const photo of unsyncedPhotos) {
    if (photo.retry_count && photo.retry_count > 0 && Date.now() < (photo.created_at ? new Date(photo.created_at).getTime() : 0) + backoffMs(photo.retry_count)) {
      failed++;
      continue;
    }
    try {
      const form = new FormData();
      form.append('file', {
        uri: photo.uri,
        name: photo.file_name || `photo-${Date.now()}.jpg`,
        type: photo.mime_type || 'image/jpeg',
      } as any);
      if (photo.checklist_item_id) {
        form.append('checklist_item_id', photo.checklist_item_id);
      }
      if (photo.caption) {
        form.append('caption', photo.caption);
      }
      form.append('captured_at', photo.created_at || new Date().toISOString());

      // Route to the right endpoint: asset evidence photos attach to the
      // fixed asset / IT asset row instead of the visit photo stream.
      let uploadUrl = `/visits/${photo.visit_id}/photos`;
      if (photo.asset_id) {
        uploadUrl = `/visits/${photo.visit_id}/assets/${photo.asset_id}/photos`;
      } else if (photo.it_asset_row_id) {
        uploadUrl = `/visits/${photo.visit_id}/it-assets/${photo.it_asset_row_id}/photos`;
      }

      await api.post(uploadUrl, form, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'X-Device-Id': deviceId,
          'X-Idempotency-Key': photo.id,
        },
        timeout: 60000,
      });

      await markSynced('pending_photos', photo.id);
      success++;
    } catch (e: any) {
      failed++;
      const msg = `Photo ${photo.id}: ${await getErrorMessage(e)}`;
      errors.push(msg);
      await markSyncFailed('pending_photos', photo.id, msg);
    }
  }

  return { success, failed, errors };
}

export async function clearSyncedData(): Promise<void> {
  const database = await getOfflineDB();
  await database.runAsync('DELETE FROM pending_visits WHERE synced_at IS NOT NULL');
  await database.runAsync('DELETE FROM pending_checklist_items WHERE synced_at IS NOT NULL');
  await database.runAsync('DELETE FROM pending_photos WHERE synced_at IS NOT NULL');
  await database.runAsync('DELETE FROM pending_actions WHERE synced_at IS NOT NULL');
}

export async function deleteOfflineVisit(id: string): Promise<void> {
  const database = await getOfflineDB();
  // No FK cascade (enforcement is off) — clean children explicitly.
  await database.runAsync('DELETE FROM pending_checklist_items WHERE visit_id = ?', [id]);
  await database.runAsync('DELETE FROM pending_photos WHERE visit_id = ?', [id]);
  await database.runAsync('DELETE FROM pending_actions WHERE visit_id = ?', [id]);
  await database.runAsync('DELETE FROM pending_visits WHERE id = ?', [id]);
}

/** Persist the last-fetched checklist payload so the screen can render fully
 *  offline (item text, sample refs, options) when the network is down. */
export async function cacheChecklist(visitId: string, payload: any): Promise<void> {
  const database = await getOfflineDB();
  await database.runAsync(
    `INSERT OR REPLACE INTO cached_checklists (visit_id, payload, saved_at) VALUES (?, ?, ?)`,
    [visitId, JSON.stringify(payload), new Date().toISOString()]
  );
}

/** Stale-but-present cached checklist for offline rendering, or null. */
export async function getCachedChecklist(visitId: string): Promise<any | null> {
  const database = await getOfflineDB();
  const row = await database.getFirstAsync<{ payload: string; saved_at: string }>(
    'SELECT payload, saved_at FROM cached_checklists WHERE visit_id = ?',
    [visitId]
  );
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.payload);
    return { ...parsed, _cachedAt: row.saved_at };
  } catch {
    return null;
  }
}