import { describe, expect, it, vi } from 'vitest';
import type { Workout } from '../src/domain/types';
import { DEFAULT_SETTINGS, PROGRAM_DAYS, skipWorkout } from '../src/domain/program';
import { pairConnection, snapshotForWorkout, syncWorkout } from '../src/integration/powerlevel';
import { decryptSnapshot, newCode } from '../src/integration/vendor/sync.mjs';
import worker from '../integrations/relay/src/worker.mjs';

function session(accountId: string, id = 'independent-session'): Workout {
  return {
    id, revision: 1, date: '2026-10-19', startedAt: '2026-10-21T00:05:00Z', updatedAt: '2026-10-21T00:10:00Z', finishedAt: '2026-10-21T00:10:00Z',
    status: 'completed', accountId, notes: '', sync: { status: 'pending' },
    targets: [{ id: 'bench-set-one', blockId: 'bench', lift: 'bench', setNumber: 1, reps: 1, weight: null, unit: 'lb', rule: 'Calibration', rpeTarget: '6–8', kind: 'calibration' }],
    sets: [{ id: 'actual-one', targetId: 'bench-set-one', lift: 'bench', weight: 285, unit: 'lb', reps: 1, outcome: 'complete', rpe: 7, notes: '', pain: false, loggedAt: '2026-10-21T00:06:00Z' }],
  };
}

/** An independent conditional-storage harness; all HTTP stays inside this process. */
function relayHarness(initialReadBarrier = 1, loseFirstPutReply = false) {
  let reads = 0, puts = 0, commits = 0;
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const records = new Map<string, { body: string; httpEtag: string; uploaded: Date; customMetadata: { updatedAt: string } }>();
  const env = { BUCKET: {
    get: async (key: string) => {
      const observed = records.get(key) ?? null;
      if (!observed && commits === 0) {
        reads++;
        if (reads >= initialReadBarrier) release();
        await barrier;
      }
      return observed;
    },
    put: async (key: string, body: string, options: { onlyIf: Headers; customMetadata: { updatedAt: string } }) => {
      const previous = records.get(key);
      if (options.onlyIf.get('If-None-Match') === '*' && previous) return null;
      if (options.onlyIf.has('If-Match') && options.onlyIf.get('If-Match') !== previous?.httpEtag) return null;
      commits++;
      const stored = { body, httpEtag: `"independent-etag-${commits}"`, uploaded: new Date(), customMetadata: options.customMetadata };
      records.set(key, stored);
      return stored;
    },
  } };
  const fetcher: typeof fetch = vi.fn(async (url, options) => {
    const request = new Request(url, options);
    const isPut = request.method === 'PUT';
    if (isPut) puts++;
    const response = await worker.fetch(request, env);
    if (isPut && loseFirstPutReply && puts === 1) throw new TypeError('Reply lost after commit');
    return response;
  });
  return { records, fetcher, puts: () => puts, commits: () => commits };
}

describe('independent integration acceptance audit', () => {
  it('dates actual evidence in New York while retaining the scheduled session separately', () => {
    const result = snapshotForWorkout(session('test-account'));
    expect(result.sessions[0].trainingDate).toBe('2026-10-20');
    expect(result.events[0].date).toBe('2026-10-20');
    expect(result.events[0].occurredAt).toBe('2026-10-21T00:06:00Z');
  });

  it('keeps both occurrences of the daylight-saving repeated hour on November 1', () => {
    const workout = session('test-account');
    workout.date = '2026-11-02';
    workout.startedAt = '2026-11-01T05:30:00Z';
    workout.sets[0].loggedAt = '2026-11-01T06:30:00Z';
    workout.finishedAt = workout.updatedAt = '2026-11-01T06:35:00Z';
    const result = snapshotForWorkout(workout);
    expect(result.sessions[0].trainingDate).toBe('2026-11-01');
    expect(result.events[0].date).toBe('2026-11-01');
  });

  it('accepts a directly skipped session without fabricating any set evidence', () => {
    const skipped = skipWorkout(PROGRAM_DAYS.find(day => day.date === '2026-10-19')!, DEFAULT_SETTINGS, 'test-account', new Date('2026-10-19T12:00:00Z'));
    const snapshot = snapshotForWorkout(skipped);
    expect(snapshot.sessions[0].status).toBe('skipped');
    expect(snapshot.events).toEqual([]);
  });

  it('preserves concurrent sessions after an atomic creation race and explicit retry', async () => {
    const code = newCode(), connection = await pairConnection(code), relay = relayHarness(2);
    const sessions = [session(connection.accountId, 'concurrent-one'), session(connection.accountId, 'concurrent-two')];
    const results = await Promise.all(sessions.map(workout => syncWorkout(workout, code, connection.accountId, { fetcher: relay.fetcher })));
    expect(results.map(result => result.status).sort()).toEqual(['needs-attention', 'synced']);
    expect(relay.commits()).toBe(1);
    const failedIndex = results.findIndex(result => result.status === 'needs-attention');
    expect(await syncWorkout(sessions[failedIndex], code, connection.accountId, { fetcher: relay.fetcher })).toMatchObject({ status: 'synced' });
    expect(relay.commits()).toBe(2);
    const snapshot = await decryptSnapshot(code, JSON.parse([...relay.records.values()][0].body), 'smolov');
    expect(snapshot.sessions.map((item: { id: string }) => item.id).sort()).toEqual(['concurrent-one', 'concurrent-two']);
    expect(snapshot.events).toHaveLength(2);
  });

  it('reconciles a lost response and a reload through exact evidence without another PUT', async () => {
    const code = newCode(), connection = await pairConnection(code), relay = relayHarness(1, true), workout = session(connection.accountId);
    expect(await syncWorkout(workout, code, connection.accountId, { fetcher: relay.fetcher })).toMatchObject({ status: 'synced' });
    expect(await syncWorkout(JSON.parse(JSON.stringify(workout)), code, connection.accountId, { fetcher: relay.fetcher })).toMatchObject({ status: 'synced' });
    expect(relay.puts()).toBe(1);
    expect(relay.commits()).toBe(1);
  });

  it('cannot upload an account A snapshot with account B credentials', async () => {
    const first = await pairConnection(newCode()), secondCode = newCode(), second = await pairConnection(secondCode), relay = relayHarness();
    expect(await syncWorkout(session(first.accountId), secondCode, second.accountId, { fetcher: relay.fetcher })).toMatchObject({ status: 'needs-attention', retryable: false });
    expect(relay.fetcher).not.toHaveBeenCalled();
    expect(relay.records.size).toBe(0);
  });
});
