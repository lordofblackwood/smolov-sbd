import { IDBFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, ORIGINAL_PROGRAM_DAYS, PROGRAM_DAYS, finishWorkout, logSet, programDaysForWorkouts, startWorkout } from '../src/domain/program';
import type { Settings, WeekReview, Workout } from '../src/domain/types';
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

function weekReview(weekId = 'cycle-1:week-1'): WeekReview {
  return { weekId, feelings: { squat: 'easy', bench: 'decent', deadlift: 'hard' }, offsetsLb: { squat: 10, bench: 2.5, deadlift: -5 }, reviewedAt: NOW.toISOString() };
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

  it('stores different program sessions on the same actual date without rewriting legacy history', async () => {
    const state = stateWithWorkout();
    const legacy = structuredClone(state.workouts[0]);
    const first = { ...activeWorkout(), id: 'sequence-one', programSessionId: 'cycle-1:week-1:session-2' };
    const second = { ...activeWorkout(), id: 'sequence-two', programSessionId: 'cycle-1:week-1:session-3' };
    state.workouts.push(first, second);
    await saveAppState(state);
    const reopened = (await loadAppState())!;
    expect(reopened.workouts).toEqual([legacy, first, second]);
    expect(reopened.workouts.every(workout => workout.date === '2026-10-19')).toBe(true);
    expect(reopened.workouts[0]).not.toHaveProperty('programSessionId');
  });

  it('rejects duplicate program positions even when their actual workout dates differ', () => {
    const state = stateWithWorkout();
    state.workouts[0].programSessionId = 'cycle-1:week-1:session-1';
    state.workouts.push({ ...activeWorkout(), id: 'another-session', date: '2026-10-22', programSessionId: 'cycle-1:week-1:session-1' });
    expect(() => validateAppState(state, LOCAL_ACCOUNT_ID)).toThrow('duplicate identity cycle-1:week-1:session-1');
  });

  it('keeps preexisting untagged records valid when they share a scheduled date', () => {
    const state = stateWithWorkout();
    state.workouts.push({ ...activeWorkout(), id: 'another-legacy-record' });
    expect(() => validateAppState(state, LOCAL_ACCOUNT_ID)).not.toThrow();
  });

  it('persists independent lift ratings and cumulative offsets without changing saved workouts', async () => {
    const state = stateWithWorkout();
    state.weekReviews = [weekReview()];
    const before = structuredClone(state.workouts);
    await saveAppState(state);
    const reopened = (await loadAppState())!;
    expect(reopened.weekReviews).toEqual(state.weekReviews);
    expect(reopened.workouts).toEqual(before);
  });

  it('keeps legacy targets, entered actuals, and queued revisions while future pound prescriptions round up', async () => {
    const config = settings();
    config.trainingMaxes.deadlift!.weight = 315;
    let historical = activeWorkout();
    historical.targets = historical.targets.map(target => ({ ...target, weight: 270 }));
    historical = logSet(historical, {
      id: 'legacy-actual', targetId: historical.targets[0].id, lift: 'deadlift', weight: 270, unit: 'lb', reps: 3,
      outcome: 'complete', notes: 'Entered before loading changed', pain: false, loggedAt: NOW.toISOString(),
    });
    const active = startWorkout(PROGRAM_DAYS.find(day => day.date === '2026-10-20')!, config, LOCAL_ACCOUNT_ID, NOW);
    active.targets = active.targets.map(target => ({ ...target, weight: 200 }));
    const queued = enqueueWorkout({ ...createInitialState(config), workouts: [historical, active] }, finishWorkout(historical, NOW), { status: 'pending', now: NOW });
    const before = structuredClone(queued);
    const future = startWorkout(PROGRAM_DAYS.find(day => day.date === '2026-10-26')!, config, LOCAL_ACCOUNT_ID, NOW);
    expect(future.targets.every(target => target.weight === 275)).toBe(true);
    expect(queued).toEqual(before);
    await saveAppState(queued);
    const reopened = (await loadAppState())!;
    const restored = importBackup(exportBackup(reopened), createInitialState(DEFAULT_SETTINGS), LOCAL_ACCOUNT_ID, { restorePreferences: true }).state;
    expect(restored.workouts).toEqual(before.workouts);
    expect(restored.outbox).toEqual(before.outbox);
    expect(restored.workouts[0].targets[0].weight).toBe(270);
    expect(restored.workouts[0].sets[0].weight).toBe(270);
    expect(restored.workouts[1].targets[0].weight).toBe(200);
    expect(restored.settings.trainingMaxes.deadlift?.weight).toBe(315);
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

  it('reports an imported duplicate program position without replacing its local workout or outbox', () => {
    const local = stateWithWorkout();
    local.workouts[0].programSessionId = 'cycle-1:week-1:session-1';
    const incoming = stateWithWorkout();
    incoming.workouts[0] = { ...incoming.workouts[0], id: 'backup-session', date: '2026-10-22', programSessionId: 'cycle-1:week-1:session-1' };
    const queued = enqueueWorkout(incoming, finishWorkout(incoming.workouts[0], NOW));
    const result = importBackup(exportBackup(queued), local);
    expect(result.report).toMatchObject({ addedWorkouts: 0, conflictingWorkoutIds: ['backup-session'], addedOutboxEntries: 0 });
    expect(result.state.workouts).toEqual(local.workouts);
    expect(result.state.outbox).toEqual(local.outbox);
  });

  it.each(['local', 'backup'])('detects a declared program position overlapping a %s legacy record', (legacySide) => {
    const local = stateWithWorkout();
    const incoming = stateWithWorkout();
    incoming.workouts[0].id = 'backup-session';
    const tagged = legacySide === 'local' ? incoming.workouts[0] : local.workouts[0];
    tagged.programSessionId = 'cycle-1:week-1:session-1';
    tagged.date = '2026-10-22';
    const result = importBackup(exportBackup(incoming), local);
    expect(result.report.conflictingWorkoutIds).toEqual(['backup-session']);
    expect(result.state.workouts).toEqual(local.workouts);
  });

  it('preserves separate untagged legacy records when importing old backups', () => {
    const local = stateWithWorkout();
    const incoming = stateWithWorkout();
    incoming.workouts[0].id = 'backup-legacy-session';
    const result = importBackup(exportBackup(incoming), local);
    expect(result.report).toMatchObject({ addedWorkouts: 1, conflictingWorkoutIds: [] });
    expect(result.state.workouts).toHaveLength(2);
  });

  it('merges missing week reviews by week, reports conflicts, and preserves the local review', () => {
    const local = createInitialState(DEFAULT_SETTINGS);
    local.weekReviews = [weekReview()];
    const incoming = createInitialState(DEFAULT_SETTINGS);
    incoming.weekReviews = [weekReview(), weekReview('cycle-1:week-2')];
    incoming.weekReviews[0].feelings.squat = 'hard';
    incoming.weekReviews[0].offsetsLb.squat = -10;
    const result = importBackup(exportBackup(incoming), local);
    expect(result.report).toMatchObject({ addedWeekReviews: 1, conflictingWeekReviewIds: ['cycle-1:week-1'] });
    expect(result.state.weekReviews).toEqual([local.weekReviews[0], incoming.weekReviews[1]]);
    expect(local.weekReviews).toEqual([weekReview()]);
    const repeated = importBackup(exportBackup(result.state), result.state);
    expect(repeated.report).toMatchObject({ addedWeekReviews: 0, conflictingWeekReviewIds: [] });
    expect(repeated.state.weekReviews).toEqual(result.state.weekReviews);
  });

  it('preserves reviews when restoring preferences from an old backup without reviews', () => {
    const local = createInitialState(DEFAULT_SETTINGS);
    local.weekReviews = [weekReview()];
    const oldBackup = exportBackup(createInitialState(DEFAULT_SETTINGS));
    const result = importBackup(oldBackup, local, LOCAL_ACCOUNT_ID, { restorePreferences: true });
    expect(result.state.weekReviews).toEqual(local.weekReviews);
    expect(result.report).toMatchObject({ addedWeekReviews: 0, conflictingWeekReviewIds: [] });
    const oldRoundTrip = importBackup(oldBackup, createInitialState(DEFAULT_SETTINGS));
    expect(oldRoundTrip.state).not.toHaveProperty('weekReviews');
  });

  it.each([
    ['unknown week', (review: any) => { review.weekId = 'cycle-3:week-1'; }],
    ['unknown feeling', (review: any) => { review.feelings.bench = 'maybe'; }],
    ['missing lift feeling', (review: any) => { delete review.feelings.deadlift; }],
    ['nonfinite offset', (review: any) => { review.offsetsLb.squat = null; }],
    ['extreme offset', (review: any) => { review.offsetsLb.bench = 100_001; }],
    ['timezone-free review', (review: any) => { review.reviewedAt = '2026-10-19T12:00:00'; }],
  ])('rejects invalid week review data: %s', (_name, mutate) => {
    const state = createInitialState(DEFAULT_SETTINGS);
    state.weekReviews = [weekReview()];
    const envelope = JSON.parse(exportBackup(state));
    mutate(envelope.state.weekReviews[0]);
    expect(() => importBackup(JSON.stringify(envelope), createInitialState(DEFAULT_SETTINGS))).toThrow();
  });

  it('rejects duplicate week review identities without changing current data', () => {
    const state = createInitialState(DEFAULT_SETTINGS);
    state.weekReviews = [weekReview()];
    const envelope = JSON.parse(exportBackup(state));
    envelope.state.weekReviews.push(structuredClone(envelope.state.weekReviews[0]));
    expect(() => importBackup(JSON.stringify(envelope), createInitialState(DEFAULT_SETTINGS))).toThrow('duplicate identity');
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
    ['empty program position', (state: any) => { state.workouts[0].programSessionId = ' '; }],
    ['non-string program position', (state: any) => { state.workouts[0].programSessionId = 1; }],
    ['control characters in program position', (state: any) => { state.workouts[0].programSessionId = 'cycle-1:week-1:session-1\n'; }],
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
  it('round-trips program identity, actual date, and immutable targets through the existing backup format', async () => {
    const state = stateWithWorkout();
    state.workouts[0].programSessionId = 'cycle-1:week-1:session-1';
    state.workouts[0].date = '2026-10-22';
    const queued = enqueueWorkout(state, finishWorkout(state.workouts[0], NOW), { now: NOW });
    const before = structuredClone(queued);
    await saveAppState(queued);
    const reopened = (await loadAppState())!;
    const backup = exportBackup(reopened);
    const restored = importBackup(backup, createInitialState(DEFAULT_SETTINGS)).state;
    expect(JSON.parse(backup)).toMatchObject({ backupVersion: 1, state: { schemaVersion: 1 } });
    expect(restored.workouts).toEqual(before.workouts);
    expect(restored.outbox).toEqual(before.outbox);
    expect(restored.outbox[0].snapshot).toMatchObject({ programSessionId: 'cycle-1:week-1:session-1', date: '2026-10-22' });
  });

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

  it('keeps original workout targets, actuals, and queued revisions intact when applying the revised calendar', async () => {
    const originalDay = ORIGINAL_PROGRAM_DAYS.find(day => day.date === '2026-10-19')!;
    let original = startWorkout(originalDay, settings(), LOCAL_ACCOUNT_ID, NOW);
    original.targets = original.targets.map(target => ({ ...target, weight: target.lift === 'deadlift' ? 240 : 200 }));
    const target = original.targets[5];
    original = logSet(original, {
      id: 'legacy-squat-set', targetId: target.id, lift: 'squat', weight: 195, unit: 'lb', reps: 5,
      outcome: 'failed', notes: 'Actual legacy squat set', pain: false, loggedAt: NOW.toISOString(),
    });
    const finished = finishWorkout(original, NOW);
    const queued = enqueueWorkout({ ...createInitialState(settings()), workouts: [original] }, finished, { status: 'pending', now: NOW });
    const before = structuredClone(queued);
    const effective = programDaysForWorkouts(queued.workouts);
    expect(effective.find(day => day.date === '2026-10-20')?.blocks.map(block => block.lift)).toEqual(['bench']);
    expect(effective.find(day => day.date === '2026-10-27')?.blocks.map(block => block.lift)).toEqual(['squat', 'bench']);
    expect(queued).toEqual(before);
    await saveAppState(queued);
    const reopened = (await loadAppState())!;
    const restored = importBackup(exportBackup(reopened), createInitialState(DEFAULT_SETTINGS)).state;
    expect(restored.workouts).toEqual(before.workouts);
    expect(restored.outbox).toEqual(before.outbox);
    expect(restored.workouts[0].targets).toHaveLength(8);
    expect(restored.workouts[0].sets[0]).toMatchObject({ lift: 'squat', weight: 195, reps: 5, outcome: 'failed' });
    expect(restored.outbox[0].snapshot.targets).toEqual(original.targets);
    expect(restored.outbox[0].snapshot.sets).toEqual(original.sets);
    expect(programDaysForWorkouts(restored.workouts)).toEqual(effective);
  });

  it('preserves legacy calibration, confirmed TMs, and its queued revision through the Friday update', async () => {
    const originalDay = ORIGINAL_PROGRAM_DAYS.find(day => day.date === '2026-10-14')!;
    let legacy = startWorkout(originalDay, DEFAULT_SETTINGS, LOCAL_ACCOUNT_ID, NOW);
    legacy = logSet(legacy, {
      id: 'legacy-calibration-squat', targetId: legacy.targets[0].id, lift: 'squat', weight: 250, unit: 'lb', reps: 1,
      outcome: 'complete', rpe: 7, notes: 'Historical calibration', pain: false, loggedAt: NOW.toISOString(),
    });
    const finished = finishWorkout(legacy, NOW);
    const queued = enqueueWorkout({ ...createInitialState(settings()), workouts: [legacy] }, finished, { status: 'pending', now: NOW });
    const before = structuredClone(queued);
    const effective = programDaysForWorkouts(queued.workouts);
    expect(effective.filter(day => day.phase === 'calibration')).toEqual(ORIGINAL_PROGRAM_DAYS.filter(day => day.phase === 'calibration'));
    expect(effective.find(day => day.date === '2026-10-16')?.blocks.map(block => block.lift)).toEqual(['deadlift']);
    expect(queued).toEqual(before);
    await saveAppState(queued);
    const reopened = (await loadAppState())!;
    const restored = importBackup(exportBackup(reopened), createInitialState(DEFAULT_SETTINGS), LOCAL_ACCOUNT_ID, { restorePreferences: true }).state;
    expect(restored.settings.trainingMaxes).toEqual(before.settings.trainingMaxes);
    expect(restored.settings.trainingMaxes.squat?.weight).toBe(285);
    expect(restored.workouts).toEqual(before.workouts);
    expect(restored.outbox).toEqual(before.outbox);
    expect(restored.workouts[0].date).toBe('2026-10-14');
    expect(restored.workouts[0].targets.map(target => target.lift)).toEqual(['squat', 'bench']);
    expect(restored.workouts[0].sets[0]).toMatchObject({ lift: 'squat', weight: 250, reps: 1, rpe: 7 });
    expect(programDaysForWorkouts(restored.workouts)).toEqual(effective);
  });
});
