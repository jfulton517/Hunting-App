import type { SupabaseClient } from '@supabase/supabase-js';
import { load, save } from '../storage';
import type { AiResult, AiTier, Deer, Sighting, Table, TableRows, UserSettings } from './types';

export interface IdentifyRequest {
  tier: Exclude<AiTier, 'off'>;
  sighting: Sighting;
  candidates: { deer: Deer; photoPath: string | null }[];
}

/** Storage backend for a user's records. */
export interface Repo {
  kind: 'local' | 'cloud';
  list<T extends Table>(table: T): Promise<TableRows[T][]>;
  upsert<T extends Table>(table: T, row: TableRows[T]): Promise<void>;
  upsertMany<T extends Table>(table: T, rows: TableRows[T][]): Promise<void>;
  remove(table: Table, id: string): Promise<void>;
  getSettings(): Promise<Partial<UserSettings> | null>;
  saveSettings(s: UserSettings): Promise<void>;
  uploadPhoto(id: string, blob: Blob): Promise<string>;
  photoUrl(path: string): Promise<string | null>;
  deletePhoto(path: string): Promise<void>;
  /** AI photo identification; only available with an account (the API key lives on the server). */
  identify: ((req: IdentifyRequest) => Promise<AiResult>) | null;
  /** AI hunting coach answer (upgrade). */
  askCoach: ((req: { tier: Exclude<AiTier, 'off'>; question: string; situation: string; history: { q: string; a: string }[] }) => Promise<string>) | null;
  /** Checks that the AI server function is deployed and has its API key. */
  checkAi: (() => Promise<{ ok: boolean; message: string }>) | null;
}

// ------------------------------------------------------------------ device-only storage

const PHOTO_DB = 'huntcast-photos';

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PHOTO_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('photos');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbOp<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', mode);
    const r = fn(tx.objectStore('photos'));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function localRepo(): Repo {
  const urls = new Map<string, string>();
  const key = (t: Table) => `db:${t}`;
  return {
    kind: 'local',
    async list(table) {
      return load(key(table), []);
    },
    async upsert(table, row) {
      const rows = load<{ id: string }[]>(key(table), []);
      const i = rows.findIndex((r) => r.id === row.id);
      const stamped = { created_at: new Date().toISOString(), ...row };
      if (i >= 0) rows[i] = stamped;
      else rows.push(stamped);
      save(key(table), rows);
    },
    async upsertMany(table, incoming) {
      const rows = load<{ id: string }[]>(key(table), []);
      const index = new Map(rows.map((r, i) => [r.id, i]));
      for (const row of incoming) {
        const stamped = { created_at: new Date().toISOString(), ...row };
        const i = index.get(row.id);
        if (i != null) rows[i] = stamped;
        else rows.push(stamped);
      }
      save(key(table), rows);
    },
    async remove(table, id) {
      save(
        key(table),
        load<{ id: string }[]>(key(table), []).filter((r) => r.id !== id),
      );
    },
    async getSettings() {
      const s = load<(Partial<UserSettings> & { stands?: { id: string; name: string; winds: string[] }[] }) | null>('settings', null);
      // One-time upgrade: stands used to live inside settings.
      if (s?.stands?.length) {
        const rows = load<{ id: string }[]>(key('stands'), []);
        for (const st of s.stands)
          if (!rows.some((r) => r.id === st.id))
            rows.push({ ...st, place_id: null, lat: null, lon: null, kind: 'stand', notes: '', created_at: new Date().toISOString() } as { id: string });
        save(key('stands'), rows);
        delete s.stands;
        save('settings', s);
      }
      return s;
    },
    async saveSettings(s) {
      save('settings', s);
    },
    async uploadPhoto(id, blob) {
      await idbOp('readwrite', (s) => s.put(blob, id));
      return `local/${id}`;
    },
    async photoUrl(path) {
      if (urls.has(path)) return urls.get(path)!;
      try {
        const blob = await idbOp<Blob | undefined>('readonly', (s) => s.get(path.replace(/^local\//, '')) as IDBRequest<Blob | undefined>);
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        urls.set(path, url);
        return url;
      } catch {
        return null;
      }
    },
    async deletePhoto(path) {
      try {
        await idbOp('readwrite', (s) => s.delete(path.replace(/^local\//, '')));
      } catch {
        /* ignore */
      }
    },
    identify: null,
    askCoach: null,
    checkAi: null,
  };
}

// ------------------------------------------------------------------ Supabase (account) storage

const BUCKET = 'trailcam';

/** Pull the server's error message out of a functions.invoke error when there is one. */
async function errorText(error: { message?: string; context?: unknown }, fallback: string): Promise<string> {
  const ctx = error.context as Response | undefined;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.clone().json();
      if (body?.error) return String(body.error);
    } catch {
      /* not JSON */
    }
  }
  return error.message || fallback;
}

export function cloudRepo(sb: SupabaseClient, userId: string): Repo {
  const signed = new Map<string, { url: string; exp: number }>();
  const check = <T>(r: { data: T; error: { message: string } | null }): T => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };
  return {
    kind: 'cloud',
    async list(table) {
      return check(await sb.from(table).select('*').order('created_at', { ascending: true })) ?? [];
    },
    async upsert(table, row) {
      check(await sb.from(table).upsert({ ...row, user_id: userId }));
    },
    async upsertMany(table, rows) {
      for (let i = 0; i < rows.length; i += 200) {
        check(await sb.from(table).upsert(rows.slice(i, i + 200).map((r) => ({ ...r, user_id: userId }))));
      }
    },
    async remove(table, id) {
      check(await sb.from(table).delete().eq('id', id));
    },
    async getSettings() {
      const r = await sb.from('profiles').select('settings').eq('user_id', userId).maybeSingle();
      return (check(r) as { settings: Partial<UserSettings> } | null)?.settings ?? null;
    },
    async saveSettings(settings) {
      check(await sb.from('profiles').upsert({ user_id: userId, settings, updated_at: new Date().toISOString() }));
    },
    async uploadPhoto(id, blob) {
      const path = `${userId}/${id}.jpg`;
      check(await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: true }));
      return path;
    },
    async photoUrl(path) {
      const hit = signed.get(path);
      if (hit && hit.exp > Date.now()) return hit.url;
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
      if (error || !data) return null;
      signed.set(path, { url: data.signedUrl, exp: Date.now() + 55 * 60 * 1000 });
      return data.signedUrl;
    },
    async deletePhoto(path) {
      await sb.storage.from(BUCKET).remove([path]);
    },
    async identify({ tier, sighting, candidates }) {
      const { data, error } = await sb.functions.invoke('identify-deer', {
        body: {
          tier,
          photo_path: sighting.photo_path,
          candidates: candidates.map(({ deer: d, photoPath }) => ({
            id: d.id,
            name: d.name,
            description: d.description,
            points: d.points,
            age_class: d.age_class,
            reference_photo_path: photoPath,
          })),
        },
      });
      if (error) throw new Error(await errorText(error, 'Photo identification failed'));
      return data as AiResult;
    },
    async askCoach(body) {
      const { data, error } = await sb.functions.invoke('hunt-coach', { body });
      if (error) {
        const msg = await errorText(error, 'The coach is unavailable');
        throw new Error(/not found|404|Failed to send/i.test(msg + error.name) ? "The AI coach isn't deployed yet (see SETUP.md, Part 2)." : msg);
      }
      return String(data?.answer ?? '');
    },
    async checkAi() {
      const { data, error } = await sb.functions.invoke('identify-deer', { body: { ping: true } });
      if (error) {
        const msg = await errorText(error, '');
        return { ok: false, message: /not found|404|Failed to send/i.test(msg + error.name) ? "The AI function isn't deployed yet (see SETUP.md, Part 2)." : msg || 'AI check failed.' };
      }
      return data?.ok ? { ok: true, message: 'AI is set up and ready.' } : { ok: false, message: data?.error ?? 'AI check failed.' };
    },
  };
}
