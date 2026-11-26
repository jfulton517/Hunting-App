// Offline write queue: changes made without signal are kept on the phone and sent to the
// account when the connection comes back. Repeated edits to the same record collapse into
// one, so a long hunt with many logged events syncs as a single update.
import type { Repo } from './repo';
import type { Table, UserSettings } from './types';

export type OutboxOp =
  | { kind: 'upsert'; table: Table; row: { id: string } & Record<string, unknown> }
  | { kind: 'remove'; table: Table; id: string }
  | { kind: 'settings'; settings: UserSettings };

/**
 * Add an operation, collapsing it with an earlier queued change to the same record. The
 * newer change takes the earlier one's place, so records are still created before anything
 * that references them (a new stand before the hunt logged at it).
 */
export function enqueue(queue: OutboxOp[], op: OutboxOp): OutboxOp[] {
  const sameRecord = (q: OutboxOp) =>
    op.kind === 'settings'
      ? q.kind === 'settings'
      : q.kind !== 'settings' && q.table === op.table && (q.kind === 'upsert' ? q.row.id : q.id) === (op.kind === 'upsert' ? op.row.id : op.id);
  const i = queue.findIndex(sameRecord);
  if (i < 0) return [...queue, op];
  const next = queue.filter((q, j) => j <= i || !sameRecord(q));
  next[i] = op;
  return next;
}

/** Errors that mean "no connection right now" (retry later), not "the server rejected it". */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /Failed to fetch|NetworkError|Load failed|network request failed|fetch failed|timed? ?out|ERR_INTERNET|offline|AbortError/i.test(msg);
}

/** Login expired or missing: keep the change and retry after the user signs in again. */
export function isAuthError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /JWT|jwt expired|401|Unauthorized|not authenticated|Invalid Refresh Token|auth session missing/i.test(msg);
}

export interface FlushResult {
  remaining: OutboxOp[];
  sent: number;
  rejected: { op: OutboxOp; message: string }[];
}

/**
 * Send queued changes in order. Stops at the first network failure (keeping the rest);
 * changes the server rejects outright are dropped and reported so the queue can't jam.
 */
export async function flush(queue: OutboxOp[], repo: Repo, timeoutMs = 15_000): Promise<FlushResult> {
  let i = 0;
  let sent = 0;
  const rejected: FlushResult['rejected'] = [];
  for (; i < queue.length; i++) {
    const op = queue[i];
    try {
      const send = op.kind === 'upsert' ? repo.upsert(op.table, op.row as never) : op.kind === 'remove' ? repo.remove(op.table, op.id) : repo.saveSettings(op.settings);
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([send, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('Request timed out')), timeoutMs)))]).finally(() => clearTimeout(timer));
      sent++;
    } catch (e) {
      if (isNetworkError(e) || isAuthError(e)) break;
      rejected.push({ op, message: (e as Error).message });
    }
  }
  return { remaining: queue.slice(i), sent, rejected };
}
