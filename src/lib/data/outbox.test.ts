import { describe, expect, it } from 'vitest';
import { enqueue, flush, isNetworkError, type OutboxOp } from './outbox';
import type { Repo } from './repo';

const hunt = (n: number) => ({ id: 'h1', events: Array.from({ length: n }, (_, i) => ({ t: i, kind: 'called' })) });

function fakeRepo(behavior: (op: string) => 'ok' | 'offline' | 'reject') {
  const calls: string[] = [];
  const run = async (label: string) => {
    const b = behavior(label);
    if (b === 'offline') throw new TypeError('Failed to fetch');
    if (b === 'reject') throw new Error('violates row-level security policy');
    calls.push(label);
  };
  const repo = {
    upsert: (t: string, r: { id: string }) => run(`upsert ${t} ${r.id}`),
    remove: (t: string, id: string) => run(`remove ${t} ${id}`),
    saveSettings: () => run('settings'),
  } as unknown as Repo;
  return { repo, calls };
}

describe('offline outbox', () => {
  it('collapses repeated edits to the same record', () => {
    let q: OutboxOp[] = [];
    q = enqueue(q, { kind: 'upsert', table: 'hunts', row: hunt(1) });
    q = enqueue(q, { kind: 'upsert', table: 'stands', row: { id: 's1' } });
    q = enqueue(q, { kind: 'upsert', table: 'hunts', row: hunt(3) });
    expect(q).toHaveLength(2);
    expect((q[0] as unknown as { row: { events: unknown[] } }).row.events).toHaveLength(3); // latest version wins, keeps its place
    q = enqueue(q, { kind: 'remove', table: 'stands', id: 's1' });
    expect(q.map((o) => o.kind)).toEqual(['upsert', 'remove']);
    expect(q[1]).toEqual({ kind: 'remove', table: 'stands', id: 's1' });
  });

  it('sends everything when online', async () => {
    const { repo, calls } = fakeRepo(() => 'ok');
    const q: OutboxOp[] = [
      { kind: 'upsert', table: 'hunts', row: hunt(2) },
      { kind: 'settings', settings: { species: 'deer', weeks: 6, rutPeak: null, aiTier: 'off' } },
    ];
    const r = await flush(q, repo);
    expect(r.sent).toBe(2);
    expect(r.remaining).toEqual([]);
    expect(calls).toEqual(['upsert hunts h1', 'settings']);
  });

  it('keeps the rest of the queue when the signal drops mid-sync', async () => {
    let n = 0;
    const { repo } = fakeRepo(() => (n++ === 0 ? 'ok' : 'offline'));
    const q: OutboxOp[] = [
      { kind: 'upsert', table: 'hunts', row: hunt(1) },
      { kind: 'upsert', table: 'stands', row: { id: 's1' } },
      { kind: 'remove', table: 'deer', id: 'd1' },
    ];
    const r = await flush(q, repo);
    expect(r.sent).toBe(1);
    expect(r.remaining).toHaveLength(2);
  });

  it('drops changes the server rejects so the queue never jams', async () => {
    const { repo } = fakeRepo((l) => (l.startsWith('upsert stands') ? 'reject' : 'ok'));
    const r = await flush(
      [
        { kind: 'upsert', table: 'stands', row: { id: 's1' } },
        { kind: 'upsert', table: 'hunts', row: hunt(1) },
      ],
      repo,
    );
    expect(r.rejected).toHaveLength(1);
    expect(r.sent).toBe(1);
    expect(r.remaining).toEqual([]);
  });

  it('keeps changes when the login has expired', async () => {
    const repo = { upsert: async () => { throw new Error('JWT expired'); } } as unknown as Repo;
    const r = await flush([{ kind: 'upsert', table: 'hunts', row: hunt(1) }], repo);
    expect(r.rejected).toEqual([]);
    expect(r.remaining).toHaveLength(1);
  });

  it('recognizes network failures', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError(new Error('TypeError: Load failed'))).toBe(true);
    expect(isNetworkError(new Error('duplicate key value violates unique constraint'))).toBe(false);
    expect(isNetworkError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false);
  });
});
