import { IDBFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, PROGRAM_DAYS, finishWorkout, logSet, startWorkout } from '../src/domain/program';
import type { Settings, Workout } from '../src/domain/types';
import {
  DATABASE_NAME, LOCAL_ACCOUNT_ID, MAX_BACKUP_BYTES, createInitialState, enqueueWorkout,
  exportBackup, importBackup, listEligibleOutbox, loadAppState, saveAppState,
  startRestTimer, timerRemaining, updateSync, validateAppState,
} from '../src/storage';
import type { AppState } from '../src/storage';

const NOW = new Date('2026-10-19T12:00:00Z');

function settings(): Settings {
  const confirmed = { weight: 285, unit: 'lb' as const, confirmedAt: '2026-10-14T14:00:00Z', calibrationRpe: 7 };
  return { ...structuredClone(DEFAULT_SETTINGS), trainingMaxes: { squat: { ...confirmed }, bench: { ...confirmed }, deadlift: { ...confirmed } } };
}

function activeWorkout(accountId = LOCAL_ACCOUNT_ID): Workout {
  const day = PROGRAM_DAYS.find(item => item.date === '2026-10-19')!;
  return { ...startWorkout(day, settings(), accountId, NOW), id: 'workout-one' };
}

function loggedWorkout(accountId = LOCAL_ACCOUNT_ID): Workout {
  const workout = activeWorkout(accountId);
  const target = workout.targets[0];
  return logSet(workout, {
    id: 'logged-set-one', targetId: target.id, lift: target.lift, weight: 235, unit: 'lb', reps: 2,
    outcome: 'failed', notes: 'Stopped at two actual reps.', pain: false, loggedAt: '2026-10-19T12:01:00Z',
  });
}

function stateWithWorkout(accountId = LOCAL_ACCOUNT_ID): AppState {
  return { ...createInitialState(settings()), workouts: [loggedWorkout(accountId)] };
}

async function rawWrite(value: unknown, accountId = LOCAL_ACCOUNT_ID, version = 1): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, version);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('account-state')) request.result.createObjectStore('account-state');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('account-state', 'readwrite');
    transaction.objectStore('account-state').put(value, accountId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function rawRead(accountId = LOCAL_ACCOUNT_ID, version = 1): Promise<unknown> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const value = await new Promise<unknown>((resolve, reject) => {
    const request = database.transaction('account-state', 'readonly').objectStore('account-state').get(accountId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return value;
}

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('durable account storage', () => {
  it('resumes the exact partially logged workout and preserves actual reps separately', async () => {
    const state = stateWithWorkout();
    await saveAppState(state);
    const reopened = await loadAppState();
    expect(reopened).toEqual(state);
    expect(reopened!.workouts[0].status).toBe('active');
    expect(reopened!.workouts[0].targets[0].reps).toBe(3);
    expect(reopened!.workouts[0].sets[0]).toMatchObject({ reps: 2, outcome: 'failed', weight: 235 });
  });

  it('captures the saved snapshot immediately and serializes rapid logging actions', async () => {
    const first = stateWithWorkout();
    const firstSave = saveAppState(first);
    first.workouts[0].notes = 'Changed after save was requested';
    await firstSave;
    expect((await loadAppState())!.workouts[0].notes).toBe('');
    const second = structuredClone(first);
    second.workouts[0].notes = 'Second action';
    const third = structuredClone(second);
    third.workouts[0].notes = 'Third action';
    await Promise.all([saveAppState(second), saveAppState(third)]);
    expect((await loadAppState())!.workouts[0].notes).toBe('Third action');
  });

  it('keeps unpaired and paired records in separate account scopes', async () => {
    await saveAppState(stateWithWorkout());
    const paired = stateWithWorkout('existing-account-A');
    paired.workouts[0].notes = 'Paired account only';
    await saveAppState(paired, 'existing-account-A');
    expect((await loadAppState())!.workouts[0].accountId).toBe(LOCAL_ACCOUNT_ID);
    expect((await loadAppState('existing-account-A'))!.workouts[0].notes).toBe('Paired account only');
    expect(await loadAppState('existing-account-B')).toBeNull();
    await expect(saveAppState(paired, 'existing-account-B')).rejects.toThrow('different account');
  });

  it('does not report persistence success when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(saveAppState(stateWithWorkout())).rejects.toThrow('have not been saved');
    vi.stubGlobal('indexedDB', new IDBFactory());
    await saveAppState(stateWithWorkout());
    expect(await loadAppState()).not.toBeNull();
  });

  it('rejects a failed save, retains the last committed snapshot, and allows later saves', async () => {
    const saved = stateWithWorkout();
    await saveAppState(saved);
    const changed = structuredClone(saved);
    changed.workouts[0].notes = 'Unsaved change';
    const put = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Local storage is full.', 'QuotaExceededError');
    });
    await expect(saveAppState(changed)).rejects.toThrow('Local storage is full');
    put.mockRestore();
    expect((await loadAppState())!.workouts[0].notes).toBe('');
    await saveAppState(changed);
    expect((await loadAppState())!.workouts[0].notes).toBe('Unsaved change');
  });

  it('does not erase corrupt or newer schema data during load', async () => {
    const corrupt = { schemaVersion: 1, broken: true };
    await rawWrite(corrupt);
    await expect(loadAppState()).rejects.toThrow();
    expect(await rawRead()).toEqual(corrupt);
    const future = { ...stateWithWorkout(), schemaVersion: 2 };
    await rawWrite(future);
    await expect(loadAppState()).rejects.toThrow('newer tracker version');
    expect(await rawRead()).toEqual(future);
  });

  it('refuses a newer database without downgrading its contents', async () => {
    const future = { owner: 'newer-app' };
    await rawWrite(future, LOCAL_ACCOUNT_ID, 2);
    await expect(loadAppState()).rejects.toThrow();
    expect(await rawRead(LOCAL_ACCOUNT_ID, 2)).toEqual(future);
  });

  it('keeps stored target snapshots intact after a TM change', async () => {
    const state = stateWithWorkout();
    const originalTargets = structuredClone(state.workouts[0].targets);
    state.settings.trainingMaxes.deadlift!.weight = 400;
    await saveAppState(state);
    expect((await loadAppState())!.workouts[0].targets).toEqual(originalTargets);
  });
});

describe('rest timer', () => {
  it('persists an end timestamp and accounts for elapsed time while closed', async () => {
    const state = createInitialState(settings());
    state.timerEnd = startRestTimer(180, NOW.getTime());
    await saveAppState(state);
    const reopened = await loadAppState();
    expect(timerRemaining(reopened!.timerEnd, NOW.getTime() + 65_200)).toBe(115);
    expect(timerRemaining(reopened!.timerEnd, NOW.getTime() + 181_000)).toBe(0);
    expect(timerRemaining(null)).toBe(0);
  });

  it('rejects invalid rest duration instead of saving an invalid timestamp', () => {
    expect(() => startRestTimer(-1)).toThrow();
    expect(() => startRestTimer(Number.NaN)).toThrow();
  });
});

describe('JSON backup protection', () => {
  it('restores validated data, preserves local preferences, and deduplicates reimports', () => {
    const incoming = stateWithWorkout();
    incoming.timerEnd = NOW.getTime() + 180_000;
    const backup = exportBackup(incoming, LOCAL_ACCOUNT_ID, NOW);
    const empty = createInitialState(DEFAULT_SETTINGS);
    const first = importBackup(backup, empty);
    expect(first.report.addedWorkouts).toBe(1);
    expect(first.state.settings).toEqual(DEFAULT_SETTINGS);
    expect(first.state.timerEnd).toBeNull();
    const second = importBackup(backup, first.state);
    expect(second.report).toMatchObject({ addedWorkouts: 0, duplicateWorkouts: 1, conflictingWorkoutIds: [] });
    expect(second.state.workouts).toHaveLength(1);
    const explicit = importBackup(backup, empty, LOCAL_ACCOUNT_ID, { restorePreferences: true });
    expect(explicit.state.settings).toEqual(incoming.settings);
    expect(explicit.state.timerEnd).toBe(incoming.timerEnd);
  });

  it('reports conflicting stable IDs and preserves the current local record', () => {
    const local = stateWithWorkout();
    const incoming = structuredClone(local);
    incoming.workouts[0].notes = 'Different backup contents';
    const result = importBackup(exportBackup(incoming), local);
    expect(result.report.conflictingWorkoutIds).toEqual(['workout-one']);
    expect(result.state.workouts[0].notes).toBe('');
    expect(local.workouts[0].notes).toBe('');
  });

  it('rejects foreign account backups and cannot reassign imported outbox identities', () => {
    const foreign = stateWithWorkout('account-A');
    expect(() => importBackup(exportBackup(foreign, 'account-A'), createInitialState(DEFAULT_SETTINGS))).toThrow('different account');
    const queued = enqueueWorkout(stateWithWorkout(), finishWorkout(loggedWorkout(), NOW));
    const envelope = JSON.parse(exportBackup(queued));
    envelope.state.outbox[0].snapshot.accountId = 'account-B';
    expect(() => importBackup(JSON.stringify(envelope), createInitialState(DEFAULT_SETTINGS))).toThrow('different account');
  });

  it('rejects malformed JSON, future versions, oversized files and duplicate session IDs', () => {
    const current = createInitialState(DEFAULT_SETTINGS);
    expect(() => importBackup('{', current)).toThrow('valid JSON');
    expect(() => importBackup(' '.repeat(MAX_BACKUP_BYTES + 1), current)).toThrow('5 MB');
    const envelope = JSON.parse(exportBackup(stateWithWorkout()));
    envelope.state.schemaVersion = 2;
    expect(() => importBackup(JSON.stringify(envelope), current)).toThrow('newer tracker version');
    envelope.state.schemaVersion = 1;
    envelope.state.workouts.push(structuredClone(envelope.state.workouts[0]));
    expect(() => importBackup(JSON.stringify(envelope), current)).toThrow('duplicate identity');
    expect(current.workouts).toEqual([]);
  });

  it.each([
    ['fractional actual reps', (state: any) => { state.workouts[0].sets[0].reps = 1.5; }],
    ['unknown weight unit', (state: any) => { state.workouts[0].sets[0].unit = 'stones'; }],
    ['working-set RPE', (state: any) => { state.workouts[0].sets[0].rpe = 8; }],
    ['unmatched target identity', (state: any) => { state.workouts[0].sets[0].targetId = 'missing'; }],
    ['zero performed weight', (state: any) => { state.workouts[0].sets[0].weight = 0; }],
    ['skipped planned reps', (state: any) => { state.workouts[0].sets[0].outcome = 'skipped'; }],
    ['timezone-free activity', (state: any) => { state.workouts[0].sets[0].loggedAt = '2026-10-19T12:01:00'; }],
    ['impossible scheduled date', (state: any) => { state.workouts[0].date = '2026-02-30'; }],
    ['unexpected nested field', (state: any) => { state.workouts[0].targets[0].extra = true; }],
    ['false completed session', (state: any) => { state.workouts[0].status = 'completed'; state.workouts[0].finishedAt = NOW.toISOString(); }],
  ])('rejects invalid nested field: %s', (_name, mutate) => {
    const envelope = JSON.parse(exportBackup(stateWithWorkout()));
    mutate(envelope.state);
    expect(() => importBackup(JSON.stringify(envelope), createInitialState(DEFAULT_SETTINGS))).toThrow();
  });

  it('merges meet attempts by lift/attempt slot without replacing a local result', () => {
    const local = createInitialState(DEFAULT_SETTINGS);
    local.meet.attempts.push({ id: 'local-squat-1', lift: 'squat', number: 1, weight: 200, unit: 'kg', outcome: 'good', notes: '' });
    const incoming = createInitialState(DEFAULT_SETTINGS);
    incoming.meet.attempts.push({ id: 'backup-squat-1', lift: 'squat', number: 1, weight: 205, unit: 'kg', outcome: 'good', notes: '' });
    const merged = importBackup(exportBackup(incoming), local);
    expect(merged.report.conflictingMeetSlots).toEqual(['squat:1']);
    expect(merged.state.meet.attempts).toEqual(local.meet.attempts);
  });
});

describe('durable outbox', () => {
  it('defaults to honest needs-attention without uploads and preserves stable identity on reload', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const state = stateWithWorkout();
    const finished = finishWorkout(state.workouts[0], NOW);
    const queued = enqueueWorkout(state, finished, { now: NOW });
    expect(queued.outbox[0].status).toBe('needs-attention');
    expect(queued.workouts[0].sync.status).toBe('needs-attention');
    expect(listEligibleOutbox(queued, LOCAL_ACCOUNT_ID, NOW)).toEqual([]);
    await saveAppState(queued);
    const reopened = (await loadAppState())!;
    const again = enqueueWorkout(reopened, reopened.workouts[0], { now: NOW });
    expect(again.outbox).toHaveLength(1);
    expect(again.outbox[0].id).toBe(queued.outbox[0].id);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('captures immutable queued revisions and supersedes unsent edits safely', () => {
    const finished = finishWorkout(loggedWorkout(), NOW);
    const queued = enqueueWorkout(stateWithWorkout(), finished, { status: 'pending', now: NOW });
    const corrected = { ...structuredClone(finished), revision: finished.revision + 1, notes: 'Correction' };
    const next = enqueueWorkout(queued, corrected, { status: 'pending', now: NOW });
    corrected.notes = 'Mutated after queuing';
    expect(next.outbox[0].snapshot.notes).toBe('');
    expect(next.outbox[0].status).toBe('needs-attention');
    expect(next.outbox[1].snapshot.notes).toBe('Correction');
    expect(listEligibleOutbox(next, LOCAL_ACCOUNT_ID, NOW)).toHaveLength(1);
    expect(listEligibleOutbox(next, 'other-account', NOW)).toEqual([]);
  });

  it('rejects conflicting contents under the same session revision', () => {
    const finished = finishWorkout(loggedWorkout(), NOW);
    const queued = enqueueWorkout(stateWithWorkout(), finished, { status: 'pending', now: NOW });
    expect(() => enqueueWorkout(queued, { ...finished, notes: 'Changed without revision' })).toThrow('same session revision');
  });

  it('schedules only explicit transient retries and pauses auth/ambiguous outcomes', () => {
    const finished = finishWorkout(loggedWorkout(), NOW);
    const queued = enqueueWorkout(stateWithWorkout(), finished, { status: 'pending', now: NOW });
    const transient = updateSync(queued, finished.id, finished.revision, { status: 'pending', reason: 'Offline before upload', retryable: true }, NOW);
    expect(listEligibleOutbox(transient, LOCAL_ACCOUNT_ID, NOW)).toEqual([]);
    expect(listEligibleOutbox(transient, LOCAL_ACCOUNT_ID, new Date(NOW.getTime() + 3000))).toHaveLength(1);
    const ambiguous = updateSync(transient, finished.id, finished.revision, { status: 'failed', ambiguous: true, retryable: true, reason: 'Reconciliation required' }, NOW);
    expect(ambiguous.outbox[0]).toMatchObject({ status: 'needs-attention', nextAttemptAt: null });
    expect(listEligibleOutbox(ambiguous, LOCAL_ACCOUNT_ID, new Date(NOW.getTime() + 3600_000))).toEqual([]);
    const auth = updateSync(queued, finished.id, finished.revision, { status: 'needs-attention', reason: 'Pairing expired', retryable: false }, NOW);
    expect(auth.workouts[0].sync.status).toBe('needs-attention');
  });

  it('does not mark the latest correction synced after an older revision succeeds', () => {
    const finished = finishWorkout(loggedWorkout(), NOW);
    const queued = enqueueWorkout(stateWithWorkout(), finished, { status: 'pending', now: NOW });
    const corrected = { ...finished, revision: finished.revision + 1, notes: 'Latest' };
    const next = enqueueWorkout(queued, corrected, { status: 'pending', now: NOW });
    const result = updateSync(next, finished.id, finished.revision, { status: 'synced', syncedAt: NOW.toISOString() }, NOW);
    expect(result.outbox[0].status).toBe('synced');
    expect(result.workouts[0].sync.status).toBe('pending');
    validateAppState(result, LOCAL_ACCOUNT_ID);
  });

  it('round-trips immutable blocked outbox entries through a backup without duplicate operations', () => {
    const finished = finishWorkout(loggedWorkout(), NOW);
    const queued = enqueueWorkout(stateWithWorkout(), finished, { now: NOW });
    const restored = importBackup(exportBackup(queued), createInitialState(DEFAULT_SETTINGS)).state;
    expect(restored.outbox).toEqual(queued.outbox);
    const again = importBackup(exportBackup(queued), restored);
    expect(again.state.outbox).toHaveLength(1);
    expect(again.report.addedOutboxEntries).toBe(0);
  });
});
