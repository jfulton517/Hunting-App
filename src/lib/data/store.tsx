import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { accountsEnabled, SUPABASE_ANON_KEY, SUPABASE_URL } from '../../config';
import { cloudRepo, localRepo, type Repo } from './repo';
import { DEFAULT_SETTINGS, type Table, type TableRows, type UserSettings } from './types';

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient | null {
  if (!accountsEnabled()) return null;
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  return client;
}

type Rows = { [T in Table]: TableRows[T][] };
const EMPTY: Rows = { places: [], stands: [], cameras: [], deer: [], sightings: [] };
const TABLES: Table[] = ['places', 'stands', 'cameras', 'deer', 'sightings'];

interface DataState {
  /** 'none' when accounts aren't configured (device-only mode) */
  auth: 'loading' | 'signed-out' | 'signed-in' | 'none';
  email: string | null;
  repo: Repo;
  rows: Rows;
  settings: UserSettings;
  loaded: boolean;
  error: string | null;
  save<T extends Table>(table: T, row: TableRows[T]): Promise<void>;
  saveMany<T extends Table>(table: T, rows: TableRows[T][]): Promise<void>;
  remove(table: Table, id: string): Promise<void>;
  setSettings(s: UserSettings): void;
  signOut(): Promise<void>;
  /** Copy records saved on this device into the signed-in account. */
  importLocal(): Promise<number>;
  localCount: number;
}

const Ctx = createContext<DataState | null>(null);

export function useData(): DataState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData must be inside <DataProvider>');
  return v;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const sb = supabase();
  const [session, setSession] = useState<Session | null | undefined>(sb ? undefined : null);
  const [rows, setRows] = useState<Rows>(EMPTY);
  const [settings, setSettingsState] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localCount, setLocalCount] = useState(0);

  useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [sb]);

  const userId = session?.user.id ?? null;
  const repo = useMemo<Repo>(() => (sb && userId ? cloudRepo(sb, userId) : localRepo()), [sb, userId]);

  useEffect(() => {
    if (sb && session === undefined) return; // still checking login
    if (sb && !session) {
      setRows(EMPTY);
      setLoaded(false);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    (async () => {
      try {
        const lists = await Promise.all(TABLES.map((t) => repo.list(t)));
        const s = await repo.getSettings();
        if (cancelled) return;
        setRows(Object.fromEntries(TABLES.map((t, i) => [t, lists[i]])) as Rows);
        setSettingsState({ ...DEFAULT_SETTINGS, ...(s ?? {}) });
        setError(null);
        if (repo.kind === 'cloud') {
          const local = localRepo();
          const counts = await Promise.all(TABLES.map((t) => local.list(t)));
          setLocalCount(counts.reduce((n, l) => n + l.length, 0));
        }
      } catch (e) {
        if (!cancelled) setError(`Couldn't load your data: ${(e as Error).message}`);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, sb, session]);

  const save = useCallback(
    async <T extends Table>(table: T, row: TableRows[T]) => {
      setRows((r) => {
        const list = r[table] as TableRows[T][];
        const i = list.findIndex((x) => x.id === row.id);
        const next = i >= 0 ? list.map((x) => (x.id === row.id ? row : x)) : [...list, row];
        return { ...r, [table]: next };
      });
      try {
        await repo.upsert(table, row);
      } catch (e) {
        setError(`Couldn't save: ${(e as Error).message}`);
        throw e;
      }
    },
    [repo],
  );

  const saveMany = useCallback(
    async <T extends Table>(table: T, incoming: TableRows[T][]) => {
      if (!incoming.length) return;
      const byId = new Map(incoming.map((r) => [r.id, r]));
      setRows((r) => {
        const list = r[table] as TableRows[T][];
        const seen = new Set<string>();
        const next = list.map((x) => {
          const u = byId.get(x.id);
          if (u) seen.add(x.id);
          return u ?? x;
        });
        for (const row of incoming) if (!seen.has(row.id)) next.push(row);
        return { ...r, [table]: next };
      });
      try {
        await repo.upsertMany(table, incoming);
      } catch (e) {
        setError(`Couldn't save: ${(e as Error).message}`);
        throw e;
      }
    },
    [repo],
  );

  const remove = useCallback(
    async (table: Table, id: string) => {
      setRows((r) => ({ ...r, [table]: (r[table] as { id: string }[]).filter((x) => x.id !== id) }));
      try {
        await repo.remove(table, id);
      } catch (e) {
        setError(`Couldn't delete: ${(e as Error).message}`);
      }
    },
    [repo],
  );

  const setSettings = useCallback(
    (s: UserSettings) => {
      setSettingsState(s);
      repo.saveSettings(s).catch((e) => setError(`Couldn't save settings: ${e.message}`));
    },
    [repo],
  );

  const importLocal = useCallback(async () => {
    const local = localRepo();
    let n = 0;
    // Parents before children so foreign keys resolve.
    for (const t of TABLES) {
      for (const row of await local.list(t)) {
        const copy = { ...row } as TableRows[typeof t];
        if (t === 'sightings') {
          const s = copy as TableRows['sightings'];
          if (s.photo_path?.startsWith('local/')) {
            const url = await local.photoUrl(s.photo_path);
            if (url) {
              const blob = await (await fetch(url)).blob();
              s.photo_path = await repo.uploadPhoto(s.id, blob);
            } else s.photo_path = null;
          }
        }
        await repo.upsert(t, copy);
        n++;
      }
    }
    const lists = await Promise.all(TABLES.map((t) => repo.list(t)));
    setRows(Object.fromEntries(TABLES.map((t, i) => [t, lists[i]])) as Rows);
    for (const t of TABLES) for (const row of await local.list(t)) await local.remove(t, row.id);
    setLocalCount(0);
    return n;
  }, [repo]);

  const value: DataState = {
    auth: !sb ? 'none' : session === undefined ? 'loading' : session ? 'signed-in' : 'signed-out',
    email: session?.user.email ?? null,
    repo,
    rows,
    settings,
    loaded,
    error,
    save,
    saveMany,
    remove,
    setSettings,
    signOut: async () => {
      await sb?.auth.signOut();
    },
    importLocal,
    localCount,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
