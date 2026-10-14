import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSnapshot } from '../public/shared/history.mjs';
import { dashboard } from '../src/lib/scoring.mjs';
import { newCode, encryptSnapshot, decryptSnapshot } from '../public/shared/sync.mjs';

function snapshot() {
  const date = '2026-10-14', timestamp = '2026-10-14T16:00:00Z';
  const session = { id: 'calibration', revision: 1, trainingDate: date, scheduledDate: date, startedAt: timestamp, updatedAt: timestamp, finishedAt: timestamp, status: 'completed', notes: '' };
  const events = [['backSquat', 'Back Squat', 250], ['benchPress', 'Bench Press', 200], ['deadlift', 'Deadlift', 300]].map(([exercise, name, weight]) => ({
    id: `calibration:${exercise}`, source: 'smolov', sessionId: session.id, setId: exercise, revision: 1, date, occurredAt: timestamp, exercise, name,
    weight, unit: 'lb', originalWeight: weight, originalUnit: 'lb', sets: 1, reps: 1, outcome: 'completed', success: true,
    singleCompleted: true, countsDay: true, kind: 'calibration', notes: '', pain: false, rpe: 7,
  }));
  return { schema: 1, source: 'smolov', contract: 'smolov-v1', sessions: [session], events };
}

test('Smolov source decrypts through the original encryption client and validates exact evidence', async () => {
  const original = snapshot(), code = newCode();
  assert.deepEqual(validateSnapshot(original, 'smolov'), original);
  assert.deepEqual(await decryptSnapshot(code, await encryptSnapshot(code, original), 'smolov'), original);
});

test('proven Smolov singles use existing dashboard scoring without changing other sources', () => {
  const source = snapshot(), scored = dashboard({ smolov: source }, '2026-10-14');
  assert.equal(scored.strength.total, 750);
  assert.equal(scored.strength.complete, true);
  assert.equal(scored.consistency.totalDays, 1);
  assert.equal(scored.accessories.length, 0);
  assert.equal(scored.bodyweight.length, 0);
});

test('failed, skipped, warm-up and multi-rep evidence never become a proven single', () => {
  const source = snapshot();
  source.events[0] = { ...source.events[0], weight: 999, originalWeight: 999, outcome: 'failed', success: false, singleCompleted: false };
  source.events[1] = { ...source.events[1], weight: null, originalWeight: null, outcome: 'skipped', reps: 0, success: false, singleCompleted: false, countsDay: false };
  delete source.events[1].rpe;
  source.events[2] = { ...source.events[2], kind: 'warmup', singleCompleted: false };
  delete source.events[2].rpe;
  validateSnapshot(source, 'smolov');
  assert.equal(dashboard({ smolov: source }, '2026-10-14').strength.known, 0);
  source.events[2] = { ...source.events[2], kind: 'working', reps: 6 };
  validateSnapshot(source, 'smolov');
  assert.equal(dashboard({ smolov: source }, '2026-10-14').strength.known, 0);
});

test('unknown variants of identifiers, ordinary-set RPE and timezone-free activity are rejected', () => {
  let source = snapshot();
  source.events[0].exercise = 'made-up-squat';
  assert.throws(() => validateSnapshot(source, 'smolov'));
  source = snapshot();
  source.events[0].kind = 'working';
  assert.throws(() => validateSnapshot(source, 'smolov'));
  source = snapshot();
  source.events[0].occurredAt = '2026-10-14T16:00:00';
  assert.throws(() => validateSnapshot(source, 'smolov'));
});

test('snapshot corrections remove previous evidence without modifying the older snapshot', () => {
  const before = snapshot(), saved = structuredClone(before), after = structuredClone(before);
  after.sessions[0].revision = 2;
  after.events = after.events.filter(event => event.exercise !== 'benchPress').map(event => ({ ...event, revision: 2 }));
  validateSnapshot(after, 'smolov');
  assert.equal(dashboard({ smolov: before }, '2026-10-14').strength.complete, true);
  assert.equal(dashboard({ smolov: after }, '2026-10-14').strength.complete, false);
  assert.deepEqual(before, saved);
});
