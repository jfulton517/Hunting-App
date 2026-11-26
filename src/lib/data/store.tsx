import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { accountsEnabled, SUPABASE_ANON_KEY, SUPABASE_URL } from '../../config';
import { load, save as saveLocal } from '../storage';
import { enqueue, flush, isAuthError, isNetworkError, type OutboxOp } from './outbox';
import { cloudRepo, localRepo, type Repo } from './repo';
import { DEFAULT_SETTINGS, type Table, type TableRows, type UserSettings } from './types';

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient | null {
  if (!accountsEnabled()) return null;
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  return client;
}

type Rows = { [T in Table]: TableRows[T][] };
const EMPTY: Rows = { places: [], stands: [], cameras: [], deer: [], sightings: [], hunts: [] };
const TABLES: Table[] = ['places', 'stands', 'cameras', 'deer', 'sightings', 'hunts'];

/** Weak signal can make requests hang instead of failing; give up and work offline. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('Request timed out (weak or no signal)')), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}

interface LastUser {
  id: string;
  email: string | null;
}
interface Snapshot {
  rows: Rows;
  settings: UserSettings;
  at: number;
}

interface DataState {
  /** 'none' when accounts aren't configured (device-only mode) */
  auth: 'loading' | 'signed-out' | 'signed-in' | 'none';
  email: string | null;
  repo: Repo;
  rows: Rows;
  settings: UserSettings;
  loaded: boolean;
  error: string | null;
  /** No connection to the account right now; working from data saved on this phone. */
  offline: boolean;
  /** When the on-phone copy of the account data was last refreshed. */
  savedAt: number | null;
  /** Changes waiting to sync to the account. */
  pendingSync: number;
  syncNow(): Promise<void>;
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
  // Signed in earlier on this phone but the login can't be checked (no signal): keep working offline.
  const [offlineUser, setOfflineUser] = useState<LastUser | null>(null);
  const [rows, setRows] = useState<Rows>(EMPTY);
  const [settings, setSettingsState] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localCount, setLocalCount] = useState(0);
  const [offline, setOffline] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pendingSync, setPendingSync] = useState(0);
  const queueRef = useRef<OutboxOp[]>([]);
  const flushing = useRef(false);

  useEffect(() => {
    if (!sb) return;
    // With an expired login and no signal, checking the session can retry for ~30 s.
    // Don't make the hunter wait: after 4 s, carry on offline as the last signed-in user.
    let settled = false;
    const goOffline = (allow: boolean) => {
      if (settled) return;
      settled = true;
      const last = load<LastUser | null>('lastUser', null);
      if (last && allow) setOfflineUser(last);
      setSession(null);
    };
    const timer = setTimeout(() => goOffline(true), 4000);
    sb.auth.getSession().then(({ data, error }) => {
      clearTimeout(timer);
      if (data.session) {
        settled = true;
        setSession(data.session);
        setOfflineUser(null);
        saveLocal('lastUser', { id: data.session.user.id, email: data.session.user.email ?? null } satisfies LastUser);
        return;
      }
      goOffline(!!error || !navigator.onLine);
    });
    const { data } = sb.auth.onAuthStateChange((event, s) => {
      if (s) {
        setSession(s);
        setOfflineUser(null);
        saveLocal('lastUser', { id: s.user.id, email: s.user.email ?? null } satisfies LastUser);
      } else if (event === 'SIGNED_OUT') {
        // Login is really gone (not just no signal): stop working as that user. Queued
        // changes stay on the phone and sync after they sign in again.
        setSession(null);
        setOfflineUser(null);
      }
    });
    return () => {
      clearTimeout(timer);
      data.subscription.unsubscribe();
    };
  }, [sb]);

  const userId = session?.user.id ?? offlineUser?.id ?? null;
  const repo = useMemo<Repo>(() => (sb && userId ? cloudRepo(sb, userId) : localRepo()), [sb, userId]);
  const snapKey = userId ? `snap:${userId}` : null;
  const outboxKey = userId ? `outbox:${userId}` : null;

  const persistQueue = useCallback(
    (q: OutboxOp[]) => {
      queueRef.current = q;
      if (outboxKey) saveLocal(outboxKey, q);
      setPendingSync(q.length);
    },
    [outboxKey],
  );

  const syncNow = useCallback(async () => {
    if (repo.kind !== 'cloud' || flushing.current || !queueRef.current.length) return;
    flushing.current = true;
    try {
      const started = queueRef.current;
      const result = await flush(started, repo);
      const processed = new Set(started.slice(0, started.length - result.remaining.length));
      persistQueue(queueRef.current.filter((op) => !processed.has(op)));
      if (result.rejected.length) setError(`${result.rejected.length} change${result.rejected.length === 1 ? '' : 's'} couldn't sync: ${result.rejected[0].message}`);
      setOffline(result.remaining.length > 0);
    } finally {
      flushing.current = false;
    }
  }, [repo, persistQueue]);

  // Load data: from the account when reachable, otherwise from the copy saved on this phone.
  useEffect(() => {
    if (sb && session === undefined) return; // still checking login
    if (sb && !userId) {
      setRows(EMPTY);
      setLoaded(false);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    queueRef.current = outboxKey ? load<OutboxOp[]>(outboxKey, []) : [];
    setPendingSync(queueRef.current.length);
    // Show the copy saved on this phone right away; fresh data replaces it when it arrives.
    const snap = repo.kind === 'cloud' && snapKey ? load<Snapshot | null>(snapKey, null) : null;
    if (snap) {
      setRows({ ...EMPTY, ...snap.rows });
      setSettingsState({ ...DEFAULT_SETTINGS, ...snap.settings });
      setSavedAt(snap.at);
      setLoaded(true);
    }
    (async () => {
      try {
        if (repo.kind === 'cloud' && queueRef.current.length) await syncNow();
        const [lists, s] = await withTimeout(Promise.all([Promise.all(TABLES.map((t) => repo.list(t))), repo.getSettings()]), 10_000);
        if (cancelled) return;
        let next = Object.fromEntries(TABLES.map((t, i) => [t, lists[i]])) as Rows;
        // Changes still queued (sync interrupted) win over what the server has.
        for (const op of queueRef.current) {
          if (op.kind === 'upsert') {
            const list = next[op.table] as { id: string }[];
            next = { ...next, [op.table]: [...list.filter((r) => r.id !== op.row.id), op.row] };
          } else if (op.kind === 'remove') next = { ...next, [op.table]: (next[op.table] as { id: string }[]).filter((r) => r.id !== op.id) };
        }
        setRows(next);
        setSettingsState({ ...DEFAULT_SETTINGS, ...(s ?? {}) });
        setError(null);
        setOffline(queueRef.current.length > 0);
        setSavedAt(Date.now());
        if (repo.kind === 'cloud') {
          const local = localRepo();
          const counts = await Promise.all(TABLES.map((t) => local.list(t)));
          setLocalCount(counts.reduce((n, l) => n + l.length, 0));
        }
      } catch (e) {
        if (cancelled) return;
        if (repo.kind === 'cloud' && snap && (isNetworkError(e) || isAuthError(e))) {
          setRows({ ...EMPTY, ...snap.rows });
          setSettingsState({ ...DEFAULT_SETTINGS, ...snap.settings });
          setSavedAt(snap.at);
          setOffline(true);
          setError(null);
        } else setError(`Couldn't load your data: ${(e as Error).message}`);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, sb, session === undefined, userId]);

  // Keep an on-phone copy of the account data for use without signal.
  useEffect(() => {
    if (!loaded || repo.kind !== 'cloud' || !snapKey) return;
    const id = setTimeout(() => saveLocal(snapKey, { rows, settings, at: savedAt ?? Date.now() } satisfies Snapshot), 800);
    return () => clearTimeout(id);
  }, [rows, settings, loaded, repo.kind, snapKey, savedAt]);

  // Sync queued changes when the signal comes back, and every 30 s while any are waiting.
  useEffect(() => {
    if (repo.kind !== 'cloud') return;
    const onOnline = () => void syncNow();
    window.addEventListener('online', onOnline);
    const id = setInterval(() => queueRef.current.length && void syncNow(), 30_000);
    return () => {
      window.removeEventListener('online', onOnline);
      clearInterval(id);
    };
  }, [repo.kind, syncNow]);

  /** Write through to the account, or queue the change if there's no connection. */
  const write = useCallback(
    async (ops: OutboxOp[], direct: () => Promise<void>, failMsg: string) => {
      if (repo.kind !== 'cloud') {
        try {
          await direct();
        } catch (e) {
          setError(`${failMsg}: ${(e as Error).message}`);
          throw e;
        }
        return;
      }
      if (!navigator.onLine) {
        // Phone already knows there's no signal: queue right away instead of waiting on a timeout.
        persistQueue(ops.reduce(enqueue, queueRef.current));
        setOffline(true);
        return;
      }
      if (queueRef.current.length) {
        // Keep order: earlier offline changes go first.
        persistQueue(ops.reduce(enqueue, queueRef.current));
        void syncNow();
        return;
      }
      try {
        await withTimeout(direct(), 8_000);
        setOffline(false);
      } catch (e) {
        if (isNetworkError(e) || isAuthError(e)) {
          persistQueue(ops.reduce(enqueue, queueRef.current));
          setOffline(true);
          return;
        }
        setError(`${failMsg}: ${(e as Error).message}`);
        throw e;
      }
    },
    [repo, persistQueue, syncNow],
  );

  const save = useCallback(
    async <T extends Table>(table: T, row: TableRows[T]) => {
      setRows((r) => {
        const list = r[table] as TableRows[T][];
        const i = list.findIndex((x) => x.id === row.id);
        const next = i >= 0 ? list.map((x) => (x.id === row.id ? row : x)) : [...list, row];
        return { ...r, [table]: next };
      });
      await write([{ kind: 'upsert', table, row: row as never }], () => repo.upsert(table, row), "Couldn't save");
    },
    [repo, write],
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
      await write(
        incoming.map((row) => ({ kind: 'upsert', table, row: row as never })),
        () => repo.upsertMany(table, incoming),
        "Couldn't save",
      );
    },
    [repo, write],
  );

  const remove = useCallback(
    async (table: Table, id: string) => {
      setRows((r) => ({ ...r, [table]: (r[table] as { id: string }[]).filter((x) => x.id !== id) }));
      await write([{ kind: 'remove', table, id }], () => repo.remove(table, id), "Couldn't delete").catch(() => {});
    },
    [repo, write],
  );

  const setSettings = useCallback(
    (s: UserSettings) => {
      setSettingsState(s);
      write([{ kind: 'settings', settings: s }], () => repo.saveSettings(s), "Couldn't save settings").catch(() => {});
    },
    [repo, write],
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
    auth: !sb ? 'none' : session === undefined ? 'loading' : session || offlineUser ? 'signed-in' : 'signed-out',
    email: session?.user.email ?? offlineUser?.email ?? null,
    repo,
    rows,
    settings,
    loaded,
    error,
    offline,
    savedAt,
    pendingSync,
    syncNow,
    save,
    saveMany,
    remove,
    setSettings,
    signOut: async () => {
      saveLocal('lastUser', null);
      setOfflineUser(null);
      await sb?.auth.signOut();
    },
    importLocal,
    localCount,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
