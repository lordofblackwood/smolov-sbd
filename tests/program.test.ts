import { describe, expect, it } from 'vitest';
import {
  addDays, addWarmup, calculateWorkingWeight, confirmCalibrationTrainingMax, convertWeight,
  createTargets, DEFAULT_SETTINGS, emptyMeetAttempts, finishWorkout, formatRule, getProgramDay,
  isDateOnly, logSet, meetTotal, missingTrainingMaxes, prescribedReps, previewScheduleChanges, previewTrainingMaxChange,
  ORIGINAL_PROGRAM_DAYS, PROGRAM_DAYS, programDaysForWorkouts, roundToIncrement, roundUpToLoadablePounds, skipWorkout, startWorkout, todayDate, undoSet, validateSet, workoutSummary,
} from '../src/domain/program';
import type { Lift, LoggedSet, Settings, Workout } from '../src/domain/types';
import { createInitialState, enqueueWorkout } from '../src/storage';

const at = new Date('2026-10-16T14:00:00.000Z');
const tm = (weight = 285) => ({ weight, unit: 'lb' as const, confirmedAt: at.toISOString(), calibrationRpe: 7 });
const settings = (): Settings => ({ ...DEFAULT_SETTINGS, trainingMaxes: { squat: tm(), bench: tm(), deadlift: tm() } });
const programDay = (date: string) => {
  const found = getProgramDay(date);
  if (!found) throw new Error(`Missing test day ${date}`);
  return found;
};
const set = (workout: Workout, index = 0, values: Partial<LoggedSet> = {}): LoggedSet => {
  const target = workout.targets[index];
  return {
    id: `logged:${index}`, targetId: target.id, lift: target.lift,
    weight: target.weight ?? 285, unit: target.unit, reps: target.reps, outcome: 'complete',
    ...(target.rpeTarget ? { rpe: 7 } : {}), notes: '', pain: false, loggedAt: at.toISOString(), ...values,
  };
};

describe('the confirmed immutable meet-prep schedule', () => {
  it('contains every date October 14–November 15, in order, including recovery days', () => {
    expect(PROGRAM_DAYS).toHaveLength(33);
    expect(PROGRAM_DAYS.map(day => day.date)).toEqual(Array.from({ length: 33 }, (_, index) => addDays('2026-10-14', index)));
    expect(new Set(PROGRAM_DAYS.map(day => day.date)).size).toBe(33);
    expect(Object.isFrozen(PROGRAM_DAYS)).toBe(true);
    expect(PROGRAM_DAYS.every(day => Object.isFrozen(day) && Object.isFrozen(day.blocks) && day.blocks.every(Object.isFrozen))).toBe(true);
  });

  it('starts all three calibration singles Friday and preserves peak/taper prescriptions', () => {
    const expected: Record<string, string[]> = {
      '2026-10-14': [],
      '2026-10-15': [],
      '2026-10-16': ['squat 1×1 calibration RPE6–8', 'bench 1×1 calibration RPE6–8', 'deadlift 1×1 calibration RPE6–8'],
      '2026-10-17': [], '2026-10-18': [],
      '2026-11-02': ['squat 1×1 100%', 'squat 2×2 75%', 'bench 1×1 100%', 'bench 2×2 80%'],
      '2026-11-03': [],
      '2026-11-04': ['deadlift 1×1 final-single RPE8', 'deadlift 2×2 75%', 'bench 3×2 80%'],
      '2026-11-05': [],
      '2026-11-06': ['squat 1×1 final-single RPE8', 'bench 1×1 final-single RPE8–8.5', 'bench 2×2 75%'],
      '2026-11-07': [], '2026-11-08': [],
      '2026-11-09': ['squat 2×2 75%', 'bench 2×2 75%', 'deadlift 2×1 70%'],
      '2026-11-10': [], '2026-11-11': ['bench 2×1 75%'],
      '2026-11-12': [], '2026-11-13': [], '2026-11-14': [], '2026-11-15': [],
    };
    for (const [date, blocks] of Object.entries(expected)) {
      expect(programDay(date).blocks.map(block => `${block.lift} ${block.sets}×${block.reps} ${block.percent === undefined ? `${block.kind} RPE${block.rpeTarget}` : `${block.percent}%`}`), date).toEqual(blocks);
    }
    expect(PROGRAM_DAYS.filter(day => day.phase === 'peak' && day.blocks.length)).toHaveLength(3);
    expect(PROGRAM_DAYS.filter(day => day.phase === 'taper' && day.blocks.length)).toHaveLength(2);
    expect(PROGRAM_DAYS.filter(day => day.phase === 'taper').every(day => !day.optionalAccessories)).toBe(true);
  });

  it.each(['volume-1', 'volume-2'] as const)('%s contains exactly six lifting days and the required totals', phase => {
    const week = PROGRAM_DAYS.filter(day => day.phase === phase);
    expect(week.filter(day => day.blocks.length)).toHaveLength(6);
    const expectedBlocks = [
      [['deadlift', 5, 3, 85]],
      [['squat', 3, 6, 70], ['bench', 3, 6, 70]],
      [['squat', 4, 5, 75], ['bench', 4, 5, 75]],
      [['deadlift', 3, 6, 70], ['bench', 5, 3, 85]],
      [['squat', 4, 4, 80], ['bench', 4, 4, 80]],
      [['squat', 5, 3, 85]],
      [],
    ];
    expect(week.map(day => day.blocks.map(block => [block.lift, block.sets, block.reps, block.percent]))).toEqual(expectedBlocks);
    expect(prescribedReps(week)).toEqual({ squat: 69, bench: 69, deadlift: 33, combined: 171 });
    for (const [lift, count] of [['squat', 4], ['bench', 4], ['deadlift', 2]] as const) {
      expect(week.filter(day => day.blocks.some(block => block.lift === lift))).toHaveLength(count);
    }
    expect(week.filter(day => day.optionalAccessories).map(day => day.date)).toEqual(phase === 'volume-1' ? ['2026-10-20', '2026-10-23'] : ['2026-10-27', '2026-10-30']);
  });

  it('puts bench second on every paired volume day and leaves heavy squat alone', () => {
    for (const phase of ['volume-1', 'volume-2'] as const) {
      const week = PROGRAM_DAYS.filter(day => day.phase === phase);
      expect(week.filter(day => day.blocks.length === 2).every(day => day.blocks[1].lift === 'bench')).toBe(true);
      const lightDeadlift = week.find(day => day.blocks.some(block => block.lift === 'deadlift' && block.percent === 70))!;
      expect(lightDeadlift.blocks.map(block => block.lift)).toEqual(['deadlift', 'bench']);
      expect(lightDeadlift.blocks[1]).toMatchObject({ sets: 5, reps: 3, percent: 85 });
      const heavySquat = week.find(day => day.blocks.some(block => block.lift === 'squat' && block.percent === 85))!;
      expect(heavySquat.blocks).toHaveLength(1);
    }
  });

  it('requests RPE on exactly the calibration and final heavy singles', () => {
    const targeted = PROGRAM_DAYS.flatMap(day => day.blocks).filter(block => block.rpeTarget);
    expect(targeted).toHaveLength(6);
    expect(targeted.every(block => block.kind !== 'working')).toBe(true);
    const working = PROGRAM_DAYS.flatMap(day => day.blocks).filter(block => block.kind === 'working');
    expect(working.every(block => block.rpeTarget === undefined)).toBe(true);
    expect(programDay('2026-11-02').blocks.every(block => block.percent !== undefined && !block.rpeTarget)).toBe(true);
  });
});

describe('Friday calibration around saved workouts', () => {
  const originalDay = (date: string) => ORIGINAL_PROGRAM_DAYS.find(day => day.date === date)!;
  const calibrationDays = (days: typeof PROGRAM_DAYS) => days.filter(day => day.phase === 'calibration');

  it('keeps original calibration source definitions available for historical snapshots', () => {
    expect(originalDay('2026-10-14').blocks.map(block => block.lift)).toEqual(['squat', 'bench']);
    expect(originalDay('2026-10-16').blocks.map(block => block.lift)).toEqual(['deadlift']);
    expect(calibrationDays(PROGRAM_DAYS).filter(day => day.blocks.length).map(day => day.date)).toEqual(['2026-10-16']);
    expect(createTargets(programDay('2026-10-16'), DEFAULT_SETTINGS)).toMatchObject([
      { lift: 'squat', reps: 1, weight: null, kind: 'calibration', rpeTarget: '6–8' },
      { lift: 'bench', reps: 1, weight: null, kind: 'calibration', rpeTarget: '6–8' },
      { lift: 'deadlift', reps: 1, weight: null, kind: 'calibration', rpeTarget: '6–8' },
    ]);
  });

  it.each(['2026-10-14', '2026-10-16'])('retains the original calibration phase after a saved %s session', date => {
    const config = settings();
    const legacy = startWorkout(originalDay(date), DEFAULT_SETTINGS, 'local', at);
    const before = structuredClone({ legacy, config });
    const effective = programDaysForWorkouts([legacy]);
    expect(calibrationDays(effective)).toEqual(calibrationDays(ORIGINAL_PROGRAM_DAYS));
    expect(getProgramDay(date, [legacy])).toEqual(originalDay(date));
    expect(getProgramDay('2026-10-16', [legacy])?.blocks.map(block => block.lift)).toEqual(['deadlift']);
    expect(effective.filter(day => day.phase !== 'calibration')).toEqual(PROGRAM_DAYS.filter(day => day.phase !== 'calibration'));
    expect(previewScheduleChanges([legacy], '2026-10-14').every(change => change.after.phase !== 'calibration')).toBe(true);
    expect({ legacy, config }).toEqual(before);
  });

  it('keeps the revised Friday schedule after its SBD calibration has started', () => {
    let friday = startWorkout(programDay('2026-10-16'), DEFAULT_SETTINGS, 'local', at);
    friday = addWarmup(friday, 'bench', 5, 45, 'lb');
    friday = logSet(friday, set(friday, 1, { weight: 150, rpe: 7 }));
    const before = structuredClone(friday);
    expect(programDaysForWorkouts([friday])).toEqual(PROGRAM_DAYS);
    expect(getProgramDay('2026-10-14', [friday])?.blocks).toEqual([]);
    expect(getProgramDay('2026-10-16', [friday])?.blocks.map(block => block.lift)).toEqual(['squat', 'bench', 'deadlift']);
    expect(previewScheduleChanges([friday], '2026-10-16').every(change => change.after.phase !== 'calibration')).toBe(true);
    expect(friday).toEqual(before);
  });
});

describe('schedule changes around saved volume weeks', () => {
  const originalDay = (date: string) => ORIGINAL_PROGRAM_DAYS.find(day => day.date === date)!;
  const volumeWeek = (days: typeof PROGRAM_DAYS, phase: 'volume-1' | 'volume-2') => days.filter(day => day.phase === phase);

  it('retains frozen original definitions for every old volume prescription', () => {
    const originalBlocks = [
      [['deadlift', 5, 3, 85], ['squat', 3, 6, 70]],
      [['bench', 3, 6, 70]],
      [['squat', 4, 5, 75], ['bench', 4, 5, 75]],
      [['squat', 4, 4, 80], ['deadlift', 3, 6, 70]],
      [['bench', 4, 4, 80]],
      [['squat', 5, 3, 85], ['bench', 5, 3, 85]],
      [],
    ];
    expect(Object.isFrozen(ORIGINAL_PROGRAM_DAYS)).toBe(true);
    for (const phase of ['volume-1', 'volume-2'] as const) {
      const week = volumeWeek(ORIGINAL_PROGRAM_DAYS, phase);
      expect(week.map(day => day.blocks.map(block => [block.lift, block.sets, block.reps, block.percent]))).toEqual(originalBlocks);
      expect(prescribedReps(week)).toEqual({ squat: 69, bench: 69, deadlift: 33, combined: 171 });
      expect(week.every(day => Object.isFrozen(day) && Object.isFrozen(day.blocks) && day.blocks.every(Object.isFrozen))).toBe(true);
      for (const day of week) for (const block of day.blocks) {
        expect(block.offsetLb ?? 0).toBe(phase === 'volume-2' && block.lift !== 'deadlift' ? 5 : 0);
      }
    }
    expect(ORIGINAL_PROGRAM_DAYS.filter(day => ['peak', 'taper', 'meet'].includes(day.phase))).toEqual(PROGRAM_DAYS.filter(day => ['peak', 'taper', 'meet'].includes(day.phase)));
  });

  it('keeps the entire old active week together while applying the revised next week', () => {
    const active = startWorkout(originalDay('2026-10-19'), settings(), 'local', at);
    const snapshot = structuredClone(active);
    const effective = programDaysForWorkouts([active]);
    expect(volumeWeek(effective, 'volume-1')).toEqual(volumeWeek(ORIGINAL_PROGRAM_DAYS, 'volume-1'));
    expect(volumeWeek(effective, 'volume-2')).toEqual(volumeWeek(PROGRAM_DAYS, 'volume-2'));
    expect(getProgramDay('2026-10-20', [active])).toEqual(originalDay('2026-10-20'));
    expect(getProgramDay('2026-10-27', [active])).toEqual(programDay('2026-10-27'));
    expect(prescribedReps(volumeWeek(effective, 'volume-1'))).toEqual({ squat: 69, bench: 69, deadlift: 33, combined: 171 });
    expect(active).toEqual(snapshot);
  });

  it('preserves a started original second week independently of the first week', () => {
    const historical = finishWorkout(startWorkout(originalDay('2026-10-29'), settings(), 'local', at), at);
    const effective = programDaysForWorkouts([historical]);
    expect(volumeWeek(effective, 'volume-1')).toEqual(volumeWeek(PROGRAM_DAYS, 'volume-1'));
    expect(volumeWeek(effective, 'volume-2')).toEqual(volumeWeek(ORIGINAL_PROGRAM_DAYS, 'volume-2'));
    expect(effective.filter(day => !day.phase.startsWith('volume-'))).toEqual(PROGRAM_DAYS.filter(day => !day.phase.startsWith('volume-')));
  });

  it('does not revert a week after a revised workout has started', () => {
    const active = startWorkout(programDay('2026-10-20'), settings(), 'local', at);
    expect(active.targets.map(target => target.lift)).toEqual(['squat', 'squat', 'squat', 'bench', 'bench', 'bench']);
    expect(programDaysForWorkouts([active])).toEqual(PROGRAM_DAYS);
    expect(getProgramDay('2026-10-22', [active])?.blocks.map(block => block.lift)).toEqual(['deadlift', 'bench']);
    expect(getProgramDay('2026-10-24', [active])?.blocks.map(block => block.lift)).toEqual(['squat']);
  });

  it('shows each saved layout after importing original history into a revised week', () => {
    const original = startWorkout(originalDay('2026-10-19'), settings(), 'local', at);
    let revised = startWorkout(programDay('2026-10-20'), settings(), 'local', at);
    revised = logSet(revised, set(revised, 3, { weight: 195, reps: 4, notes: 'Saved revised bench' }));
    revised = finishWorkout(revised, at);
    const queued = enqueueWorkout({ ...createInitialState(settings()), workouts: [original, revised] }, revised, { status: 'pending', now: at });
    const before = structuredClone(queued);

    expect(getProgramDay('2026-10-19', queued.workouts)).toEqual(originalDay('2026-10-19'));
    expect(getProgramDay('2026-10-20', queued.workouts)).toEqual(programDay('2026-10-20'));
    expect(getProgramDay('2026-10-20', queued.workouts)?.blocks.map(block => block.lift)).toEqual(['squat', 'bench']);
    expect(getProgramDay('2026-10-22', queued.workouts)).toEqual(originalDay('2026-10-22'));
    expect(getProgramDay('2026-10-27', queued.workouts)).toEqual(programDay('2026-10-27'));
    expect(volumeWeek(programDaysForWorkouts(queued.workouts), 'volume-1')).toEqual(volumeWeek(ORIGINAL_PROGRAM_DAYS, 'volume-1'));
    expect(queued).toEqual(before);
    expect(queued.workouts[1].sets[0]).toMatchObject({ lift: 'bench', weight: 195, reps: 4 });
    expect(queued.outbox[0].snapshot).toEqual(before.outbox[0].snapshot);
  });

  it('does not mistake warm-ups, loading preferences, or performed-set edits for a legacy schedule', () => {
    const config = { ...settings(), unit: 'kg' as const, increment: 2.5 };
    let active = addWarmup(startWorkout(programDay('2026-10-22'), config, 'local', at), 'bench', 5, 20, 'kg');
    active = logSet(active, set(active, 0, { weight: 70, reps: 4 }));
    active.targets[0].weight = 72.5;
    const before = structuredClone(active);
    expect(programDaysForWorkouts([active])).toEqual(PROGRAM_DAYS);
    expect(active).toEqual(before);
  });

  it('uses the preserved calendar when previewing unstarted TM changes', () => {
    const legacy = startWorkout(originalDay('2026-10-19'), settings(), 'local', at);
    const before = structuredClone(legacy);
    const changes = previewTrainingMaxChange('bench', tm(300), settings(), [legacy], '2026-10-14');
    const dates = [...new Set(changes.map(change => change.date))];
    expect(dates).toContain('2026-10-24');
    expect(dates).not.toContain('2026-10-22');
    expect(dates).toContain('2026-10-29');
    expect(dates).not.toContain('2026-10-31');
    expect(legacy).toEqual(before);
  });

  it('previews only changed, future, unstarted days outside a retained legacy week', () => {
    const allChanges = previewScheduleChanges([], '2026-10-14');
    expect(allChanges.map(change => change.date)).toEqual([
      '2026-10-14', '2026-10-16',
      '2026-10-19', '2026-10-20', '2026-10-22', '2026-10-23', '2026-10-24',
      '2026-10-26', '2026-10-27', '2026-10-29', '2026-10-30', '2026-10-31',
    ]);
    expect(allChanges.find(change => change.date === '2026-10-22')).toMatchObject({
      before: { blocks: [{ lift: 'squat' }, { lift: 'deadlift' }] },
      after: { blocks: [{ lift: 'deadlift' }, { lift: 'bench' }] },
    });
    const legacy = startWorkout(originalDay('2026-10-19'), settings(), 'local', at);
    expect(previewScheduleChanges([legacy], '2026-10-14').map(change => change.date)).toEqual([
      '2026-10-14', '2026-10-16',
      '2026-10-26', '2026-10-27', '2026-10-29', '2026-10-30', '2026-10-31',
    ]);
    const revised = startWorkout(programDay('2026-10-30'), settings(), 'local', at);
    expect(previewScheduleChanges([legacy, revised], '2026-10-30').map(change => change.date)).toEqual(['2026-10-31']);
  });
});

describe('training weights and date-only integrity', () => {
  it('does not seed any example or recent maximum as a confirmed user TM', () => {
    expect(DEFAULT_SETTINGS.unit).toBe('lb');
    expect(DEFAULT_SETTINGS.increment).toBe(5);
    expect(DEFAULT_SETTINGS.trainingMaxes).toEqual({ squat: null, bench: null, deadlift: null });
    expect(createTargets(programDay('2026-10-19'), DEFAULT_SETTINGS).every(target => target.weight === null)).toBe(true);
  });

  it('rounds the provided 285 lb prescriptions up to totals loadable without 2.5 lb plates', () => {
    for (const [percent, expected] of [[70, 205], [75, 215], [80, 235], [85, 245]]) {
      expect(calculateWorkingWeight({ lift: 'bench', percent }, settings())).toBe(expected);
    }
    expect(roundToIncrement(202.5, 5)).toBe(205);
    expect(roundToIncrement(2.5, 5)).toBe(5);
    expect(roundToIncrement(202.499, 5)).toBe(200);
    expect(() => roundToIncrement(200, 0)).toThrow();
  });

  it('rounds pound totals upward with a 45 lb bar and preserves already loadable weights', () => {
    for (const [weight, expected] of [[0, 45], [44.99, 45], [45, 45], [45.01, 55], [265, 265], [270, 275], [275, 275], [275.01, 285]]) {
      expect(roundUpToLoadablePounds(weight)).toBe(expected);
    }
    expect(roundUpToLoadablePounds(275 + Number.EPSILON * 275)).toBe(275);
    for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => roundUpToLoadablePounds(invalid)).toThrow();
    }
    const config = settings();
    config.trainingMaxes.deadlift = tm(315);
    expect(calculateWorkingWeight({ lift: 'deadlift', percent: 85 }, config)).toBe(275);
    expect(config.trainingMaxes.deadlift.weight).toBe(315);
  });

  it('applies Week 2 offsets before rounding to loadable pound totals, only to squat and bench', () => {
    for (const [percent, expected] of [[70, 205], [75, 225], [80, 235], [85, 245]]) {
      expect(calculateWorkingWeight({ lift: 'bench', percent, offsetLb: 5 }, settings())).toBe(expected);
    }
    for (const day of PROGRAM_DAYS) for (const block of day.blocks) {
      expect(block.offsetLb ?? 0).toBe(day.phase === 'volume-2' && block.lift !== 'deadlift' ? 5 : 0);
    }
    expect(formatRule(programDay('2026-10-28').blocks[1])).toBe('75% TM + 5 lb');
  });

  it('honors kilogram loading increments then adds a physical 5 lb without a second rounding', () => {
    const kgSettings = { ...settings(), unit: 'kg' as const, increment: 2.5 };
    const baseline = calculateWorkingWeight({ lift: 'squat', percent: 70 }, kgSettings);
    const progression = calculateWorkingWeight({ lift: 'squat', percent: 70, offsetLb: 5 }, kgSettings);
    expect(baseline).toBeCloseTo(90, 10);
    expect(progression).toBeCloseTo(90 + convertWeight(5, 'lb', 'kg'), 10);
    expect(convertWeight(convertWeight(285, 'lb', 'kg'), 'kg', 'lb')).toBeCloseTo(285, 10);
  });

  it('guards only percentage-based sessions when a TM is absent', () => {
    expect(missingTrainingMaxes(programDay('2026-10-19'), DEFAULT_SETTINGS)).toEqual(['deadlift']);
    expect(missingTrainingMaxes(programDay('2026-10-20'), DEFAULT_SETTINGS)).toEqual(['squat', 'bench']);
    expect(() => startWorkout(programDay('2026-10-19'), DEFAULT_SETTINGS, 'local', at)).toThrow('training max');
    expect(() => startWorkout(programDay('2026-10-16'), DEFAULT_SETTINGS, 'local', at)).not.toThrow();
    expect(startWorkout(programDay('2026-10-16'), DEFAULT_SETTINGS, 'local', at).targets.every(target => target.weight === null)).toBe(true);
    expect(skipWorkout(programDay('2026-10-19'), DEFAULT_SETTINGS, 'local', at).status).toBe('skipped');
    expect(skipWorkout(programDay('2026-10-19'), DEFAULT_SETTINGS, 'local', at).revision).toBe(1);
  });

  it('previews only unstarted future prescriptions and never rewrites historical or active snapshots', () => {
    const config = settings();
    const historical = startWorkout(programDay('2026-10-20'), config, 'local', at);
    historical.targets = historical.targets.map(target => ({ ...target, weight: 200 }));
    const history = finishWorkout(historical, at);
    const active = startWorkout(programDay('2026-10-21'), config, 'local', at);
    const snapshots = structuredClone([history, active]);
    const changes = previewTrainingMaxChange('bench', tm(300), config, [history, active], '2026-10-14');
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.some(change => change.date === '2026-10-20' || change.date === '2026-10-21')).toBe(false);
    expect(changes.every(change => change.lift === 'bench' && change.date >= '2026-10-14')).toBe(true);
    config.trainingMaxes.bench = tm(300);
    expect([history, active]).toEqual(snapshots);
    expect(history.targets[0].weight).toBe(200);
    expect(active.targets.find(target => target.lift === 'bench')?.weight).toBe(215);
  });

  it('keeps November DST calendar dates correct in New York', () => {
    expect(todayDate(new Date('2026-11-01T03:59:59Z'))).toBe('2026-10-31');
    expect(todayDate(new Date('2026-11-01T04:00:00Z'))).toBe('2026-11-01');
    expect(todayDate(new Date('2026-11-01T05:30:00Z'))).toBe('2026-11-01');
    expect(todayDate(new Date('2026-11-01T06:30:00Z'))).toBe('2026-11-01');
    expect(todayDate(new Date('2026-11-02T04:59:59Z'))).toBe('2026-11-01');
    expect(todayDate(new Date('2026-11-02T05:00:00Z'))).toBe('2026-11-02');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(isDateOnly('2026-02-30')).toBe(false);
  });
});

describe('actual performance and durable snapshot data', () => {
  it('starts with no completed sets and preserves targets when actual weight or reps differ', () => {
    const initial = startWorkout(programDay('2026-10-20'), settings(), 'account-a', at);
    expect(initial.sets).toEqual([]);
    const snapshot = structuredClone(initial.targets);
    const logged = logSet(initial, set(initial, 0, { weight: 195, reps: 4, notes: 'Adjusted load', pain: true }));
    expect(logged.targets).toEqual(snapshot);
    expect(initial.sets).toEqual([]);
    expect(logged.sets[0]).toMatchObject({ weight: 195, reps: 4, pain: true });
    expect(logged.accountId).toBe('account-a');
    expect(logged.revision).toBe(1);
    expect(workoutSummary(logged)).toMatchObject({ plannedSets: 6, loggedSets: 1, completedReps: 4, remainingSets: 5 });
    expect(() => logSet(initial, set(initial, 0, { weight: 0 }))).toThrow('actual weight lifted');
  });

  it('records failed actual reps and skipped zero reps without assigning planned reps', () => {
    let workout = startWorkout(programDay('2026-10-20'), settings(), 'local', at);
    workout = logSet(workout, set(workout, 0, { outcome: 'failed', reps: 2 }));
    workout = logSet(workout, set(workout, 1, { outcome: 'skipped', reps: 0 }));
    expect(workoutSummary(workout)).toMatchObject({ failedSets: 1, skippedSets: 1, actualReps: 2, completedReps: 0, remainingSets: 4 });
    expect(finishWorkout(workout, at).status).toBe('partial');
    expect(() => logSet(workout, set(workout, 2, { outcome: 'skipped', reps: 6 }))).toThrow('zero actual reps');
  });

  it('edits by stable set identity, supports undo, and retains the actual state through serialization', () => {
    const original = startWorkout(programDay('2026-10-20'), settings(), 'local', at);
    const first = logSet(original, set(original));
    const edited = logSet(first, set(first, 0, { id: 'replacement-must-not-change-identity', weight: 190, reps: 5 }));
    expect(edited.sets).toHaveLength(1);
    expect(edited.sets[0].id).toBe('logged:0');
    expect(JSON.parse(JSON.stringify(edited))).toEqual(edited);
    const undone = undoSet(edited, edited.targets[0].id);
    expect(undone.sets).toEqual([]);
    expect(undone.targets).toEqual(original.targets);
    expect(undone.revision).toBe(3);
  });

  it('retains the actual set occurrence timestamp when a later correction is saved', () => {
    const original = startWorkout(programDay('2026-10-20'), settings(), 'local', at);
    const first = logSet(original, set(original));
    const correctedAt = '2026-10-25T14:00:00.000Z';
    const corrected = logSet(first, set(first, 0, { weight: 190, reps: 5, loggedAt: correctedAt }));
    expect(corrected.sets[0].loggedAt).toBe(at.toISOString());
    expect(corrected.updatedAt).toBe(correctedAt);
    expect(corrected.sets[0].id).toBe(first.sets[0].id);
  });

  it('separates optional warm-ups from prescribed volume and working progress', () => {
    let workout = addWarmup(startWorkout(programDay('2026-10-20'), settings(), 'local', at), 'bench', 5, 95, 'lb');
    workout = logSet(workout, set(workout, 6));
    expect(workout.targets[6]).toMatchObject({ kind: 'warmup', rule: 'Optional warm-up' });
    expect(workout.targets[6].rpeTarget).toBeUndefined();
    expect(workoutSummary(workout)).toMatchObject({ plannedSets: 6, completedSets: 0, actualReps: 0, warmupSets: 1 });
    expect(prescribedReps(PROGRAM_DAYS.filter(day => day.phase === 'volume-1')).combined).toBe(171);
  });

  it('rejects ordinary-set RPE and requests achieved RPE only on completed designated singles', () => {
    const working = startWorkout(programDay('2026-10-20'), settings(), 'local', at);
    expect(validateSet(working, set(working, 0, { rpe: 7 }))).toContain('RPE is recorded only for calibration and final heavy singles.');
    const calibration = startWorkout(programDay('2026-10-16'), DEFAULT_SETTINGS, 'local', at);
    expect(validateSet(calibration, set(calibration, 0, { rpe: undefined }))).toContain('Record the achieved RPE for this single.');
    expect(validateSet(calibration, set(calibration, 0, { outcome: 'skipped', reps: 0, rpe: undefined }))).toEqual([]);
    expect(validateSet(working, set(working, 0, { loggedAt: '2026-11-01T01:30:00' }))).toContain('The logged timestamp must include its time zone.');
  });

  it('confirms only the actual successful RPE 6–8 calibration single without estimating maxes', () => {
    const config = settings();
    let workout = startWorkout(programDay('2026-10-16'), DEFAULT_SETTINGS, 'local', at);
    workout = logSet(workout, set(workout, 0, { weight: 250, rpe: 6.5 }));
    expect(confirmCalibrationTrainingMax(workout, workout.targets[0].id, at)).toEqual({ weight: 250, unit: 'lb', calibrationRpe: 6.5, confirmedAt: at.toISOString() });
    expect(config.trainingMaxes.squat?.weight).toBe(285);
    const unsuitable = logSet(workout, set(workout, 0, { rpe: 9 }));
    expect(() => confirmCalibrationTrainingMax(unsuitable, unsuitable.targets[0].id, at)).toThrow('RPE 6–8');
    const final = startWorkout(programDay('2026-11-06'), config, 'local', at);
    expect(final.targets[0].weight).toBeNull();
    expect(() => confirmCalibrationTrainingMax(logSet(final, set(final, 0, { weight: 315, rpe: 8 })), final.targets[0].id, at)).toThrow();
    expect(config.trainingMaxes.squat?.weight).toBe(285);
  });

  it('marks a workout completed only after all prescribed sets have actual completed outcomes', () => {
    let workout = startWorkout(programDay('2026-10-20'), settings(), 'local', at);
    expect(finishWorkout(workout, at).status).toBe('partial');
    for (let index = 0; index < workout.targets.length; index++) workout = logSet(workout, set(workout, index));
    expect(finishWorkout(workout, at).status).toBe('completed');
  });

  it('preserves the original finish timestamp when correcting a finished session', () => {
    const finished = finishWorkout(startWorkout(programDay('2026-10-20'), settings(), 'local', at), at);
    const correctedAt = new Date('2026-10-25T14:00:00.000Z');
    const corrected = finishWorkout(logSet(finished, set(finished, 0, { loggedAt: correctedAt.toISOString() })), correctedAt);
    expect(corrected.finishedAt).toBe(at.toISOString());
    expect(corrected.updatedAt).toBe(correctedAt.toISOString());
    expect(corrected.targets).toEqual(finished.targets);
  });
});

describe('meet results', () => {
  it('provides three empty attempt slots per lift and never prescribes weights or RPE', () => {
    const attempts = emptyMeetAttempts('kg');
    expect(attempts).toHaveLength(9);
    for (const lift of ['squat', 'bench', 'deadlift'] as Lift[]) {
      expect(attempts.filter(attempt => attempt.lift === lift).map(attempt => attempt.number)).toEqual([1, 2, 3]);
    }
    expect(attempts.every(attempt => attempt.weight === null && attempt.unit === 'kg' && attempt.outcome === 'not-taken')).toBe(true);
    expect(meetTotal(attempts, 'kg')).toMatchObject({ valid: false, total: null });
  });

  it('uses only best successful attempts, converts mixed units, and withholds official total for a missing lift', () => {
    const attempts = emptyMeetAttempts();
    attempts[0] = { ...attempts[0], weight: 400, outcome: 'good' };
    attempts[1] = { ...attempts[1], weight: 450, outcome: 'no-lift' };
    attempts[3] = { ...attempts[3], weight: 100, unit: 'kg', outcome: 'good' };
    expect(meetTotal(attempts, 'kg')).toMatchObject({ valid: false, total: null });
    attempts[6] = { ...attempts[6], weight: 500, outcome: 'good' };
    attempts[7] = { ...attempts[7], weight: 520, outcome: 'good' };
    attempts[8] = { ...attempts[8], weight: 600, outcome: 'not-taken' };
    const result = meetTotal(attempts, 'kg');
    expect(result.valid).toBe(true);
    expect(result.best.squat).toBeCloseTo(convertWeight(400, 'lb', 'kg'), 8);
    expect(result.best.deadlift).toBeCloseTo(convertWeight(520, 'lb', 'kg'), 8);
    expect(result.total).toBeCloseTo(convertWeight(920, 'lb', 'kg') + 100, 8);
  });
});
