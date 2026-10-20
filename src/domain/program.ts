import type {
  Block,
  Lift,
  LoggedSet,
  MeetAttempt,
  Phase,
  ProgramDay,
  SetTarget,
  Settings,
  TrainingMax,
  Unit,
  Workout,
} from "./types";

export const PROGRAM_NAME = "Modified Smolov Jr. — SBD Meet Prep";
export const MEET_DATE = "2026-11-15";
export const TIME_ZONE = "America/New_York";
export const LIFTS: readonly Lift[] = ["squat", "bench", "deadlift"];
export const LIFT_LABELS: Record<Lift, string> = {
  squat: "Squat",
  bench: "Bench",
  deadlift: "Deadlift",
};
export const PHASE_LABELS: Record<Phase, string> = {
  calibration: "Initial calibration",
  "volume-1": "Volume week 1",
  "volume-2": "Volume week 2",
  peak: "Peak week",
  taper: "Taper week",
  meet: "Meet day",
};

export const DEFAULT_SETTINGS: Settings = {
  trainingMaxes: { squat: null, bench: null, deadlift: null },
  unit: "lb",
  increment: 5,
  restSeconds: 180,
  autoRest: true,
};

const POUNDS_PER_KILOGRAM = 1 / 0.45359237;

export function convertWeight(weight: number, from: Unit, to: Unit): number {
  if (from === to) return weight;
  return from === "kg"
    ? weight * POUNDS_PER_KILOGRAM
    : weight / POUNDS_PER_KILOGRAM;
}

export function roundToIncrement(weight: number, increment: number): number {
  if (!Number.isFinite(weight) || weight < 0)
    throw new Error("Weight must be a nonnegative number.");
  if (!Number.isFinite(increment) || increment <= 0)
    throw new Error("Loading increment must be greater than zero.");
  // The epsilon only corrects floating-point representations of exact halves.
  return (
    Math.floor(
      weight / increment +
        0.5 +
        Number.EPSILON * Math.max(1, weight / increment) * 4,
    ) * increment
  );
}

/** A 45 lb bar with plates of at least 5 lb loads in 10 lb total steps. */
export function roundUpToLoadablePounds(weight: number): number {
  if (!Number.isFinite(weight) || weight < 0)
    throw new Error("Weight must be a nonnegative number.");
  const steps = Math.max(0, (weight - 45) / 10);
  // Keep exact loadable totals stable across floating-point conversions.
  return 45 + Math.ceil(steps - Number.EPSILON * Math.max(1, steps) * 4) * 10;
}

/** Date-only arithmetic uses UTC solely as a calendar, never as an activity timestamp. */
export function addDays(date: string, count: number): string {
  if (!isDateOnly(date)) throw new Error("Expected an ISO calendar date.");
  const calendar = new Date(`${date}T12:00:00Z`);
  calendar.setUTCDate(calendar.getUTCDate() + count);
  return calendar.toISOString().slice(0, 10);
}

export function isDateOnly(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T12:00:00Z`);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === date
  );
}

export function isActivityTimestamp(timestamp: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      timestamp,
    ) &&
    isDateOnly(timestamp.slice(0, 10)) &&
    !Number.isNaN(Date.parse(timestamp))
  );
}

export function todayDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function formatDate(
  date: string,
  options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    month: "long",
    day: "numeric",
  },
): string {
  if (!isDateOnly(date)) throw new Error("Expected an ISO calendar date.");
  return new Intl.DateTimeFormat("en-US", {
    ...options,
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

type DraftBlock = Omit<Block, "id">;
const working = (
  lift: Lift,
  sets: number,
  reps: number,
  percent: number,
  offsetLb = 0,
): DraftBlock => ({
  lift,
  sets,
  reps,
  percent,
  ...(offsetLb ? { offsetLb } : {}),
  kind: "working",
});
const calibration = (lift: Lift): DraftBlock => ({
  lift,
  sets: 1,
  reps: 1,
  kind: "calibration",
  rpeTarget: "6–8",
});
const finalSingle = (lift: Lift, rpeTarget: string): DraftBlock => ({
  lift,
  sets: 1,
  reps: 1,
  kind: "final-single",
  rpeTarget,
});

function day(
  date: string,
  phase: Phase,
  blocks: DraftBlock[] = [],
  recovery: string | null = null,
  optionalAccessories?: string,
): ProgramDay {
  const frozenBlocks = blocks.map((block, index) =>
    Object.freeze({ ...block, id: `${date}:${index + 1}:${block.lift}` }),
  );
  return Object.freeze({
    date,
    phase,
    blocks: Object.freeze(frozenBlocks),
    recovery,
    ...(optionalAccessories ? { optionalAccessories } : {}),
  });
}

function volumeWeek(
  startDate: string,
  phase: "volume-1" | "volume-2",
  revised = false,
): ProgramDay[] {
  const offset = phase === "volume-2" ? 5 : 0;
  if (revised)
    return [
      day(startDate, phase, [working("deadlift", 5, 3, 85)]),
      day(
        addDays(startDate, 1),
        phase,
        [
          working("squat", 3, 6, 70, offset),
          working("bench", 3, 6, 70, offset),
        ],
        null,
        "Optional light upper-back accessories",
      ),
      day(addDays(startDate, 2), phase, [
        working("squat", 4, 5, 75, offset),
        working("bench", 4, 5, 75, offset),
      ]),
      day(addDays(startDate, 3), phase, [
        working("deadlift", 3, 6, 70),
        working("bench", 5, 3, 85, offset),
      ]),
      day(
        addDays(startDate, 4),
        phase,
        [
          working("squat", 4, 4, 80, offset),
          working("bench", 4, 4, 80, offset),
        ],
        null,
        "Optional light upper-back accessories",
      ),
      day(addDays(startDate, 5), phase, [working("squat", 5, 3, 85, offset)]),
      day(addDays(startDate, 6), phase, [], "Rest"),
    ];
  return [
    day(startDate, phase, [
      working("deadlift", 5, 3, 85),
      working("squat", 3, 6, 70, offset),
    ]),
    day(
      addDays(startDate, 1),
      phase,
      [working("bench", 3, 6, 70, offset)],
      null,
      "Optional light upper-back accessories",
    ),
    day(addDays(startDate, 2), phase, [
      working("squat", 4, 5, 75, offset),
      working("bench", 4, 5, 75, offset),
    ]),
    day(addDays(startDate, 3), phase, [
      working("squat", 4, 4, 80, offset),
      working("deadlift", 3, 6, 70),
    ]),
    day(
      addDays(startDate, 4),
      phase,
      [working("bench", 4, 4, 80, offset)],
      null,
      "Optional light upper-back accessories",
    ),
    day(addDays(startDate, 5), phase, [
      working("squat", 5, 3, 85, offset),
      working("bench", 5, 3, 85, offset),
    ]),
    day(addDays(startDate, 6), phase, [], "Rest"),
  ];
}

/** Frozen source definitions. Actual workouts store independent target snapshots. */
export const ORIGINAL_PROGRAM_DAYS: readonly ProgramDay[] = Object.freeze([
  day("2026-10-14", "calibration", [
    calibration("squat"),
    calibration("bench"),
  ]),
  day("2026-10-15", "calibration", [], "Recovery"),
  day("2026-10-16", "calibration", [calibration("deadlift")]),
  day(
    "2026-10-17",
    "calibration",
    [],
    "Recovery — no prescribed heavy lifting",
  ),
  day(
    "2026-10-18",
    "calibration",
    [],
    "Recovery — no prescribed heavy lifting",
  ),
  ...volumeWeek("2026-10-19", "volume-1"),
  ...volumeWeek("2026-10-26", "volume-2"),
  day("2026-11-02", "peak", [
    working("squat", 1, 1, 100),
    working("squat", 2, 2, 75),
    working("bench", 1, 1, 100),
    working("bench", 2, 2, 80),
  ]),
  day(
    "2026-11-03",
    "peak",
    [],
    "Recovery",
    "Optional very light upper-back work",
  ),
  day("2026-11-04", "peak", [
    finalSingle("deadlift", "8"),
    working("deadlift", 2, 2, 75),
    working("bench", 3, 2, 80),
  ]),
  day("2026-11-05", "peak", [], "Easy mobility/recovery"),
  day("2026-11-06", "peak", [
    finalSingle("squat", "8"),
    finalSingle("bench", "8–8.5"),
    working("bench", 2, 2, 75),
  ]),
  day("2026-11-07", "peak", [], "Light movement/recovery"),
  day("2026-11-08", "peak", [], "Rest"),
  day("2026-11-09", "taper", [
    working("squat", 2, 2, 75),
    working("bench", 2, 2, 75),
    working("deadlift", 2, 1, 70),
  ]),
  day("2026-11-10", "taper", [], "Optional easy walking/mobility"),
  day("2026-11-11", "taper", [working("bench", 2, 1, 75)]),
  day("2026-11-12", "taper", [], "Rest"),
  day("2026-11-13", "taper", [], "Rest"),
  day("2026-11-14", "taper", [], "Rest"),
  day(MEET_DATE, "meet"),
]);

/** User-requested Friday calibration and revised volume-day pairings. */
const revisedProgramDays = new Map(
  [
    day(
      "2026-10-14",
      "calibration",
      [],
      "Recovery — calibration tests on Friday, Oct 16",
    ),
    day("2026-10-16", "calibration", [
      calibration("squat"),
      calibration("bench"),
      calibration("deadlift"),
    ]),
    ...volumeWeek("2026-10-19", "volume-1", true),
    ...volumeWeek("2026-10-26", "volume-2", true),
  ].map((item) => [item.date, item]),
);
export const PROGRAM_DAYS: readonly ProgramDay[] = Object.freeze(
  ORIGINAL_PROGRAM_DAYS.map(
    (item) => revisedProgramDays.get(item.date) ?? item,
  ),
);

function prescriptionSignature(targets: readonly SetTarget[]): string {
  return JSON.stringify(
    targets
      .filter((target) => target.kind !== "warmup")
      .map((target) => [
        target.blockId,
        target.lift,
        target.setNumber,
        target.reps,
        target.rule,
        target.kind,
        target.rpeTarget ?? null,
      ]),
  );
}

/** Retain started original phases; moved tests or working sets must not repeat. */
export function programDaysForWorkouts(
  workouts: readonly Workout[],
): readonly ProgramDay[] {
  const originalPhases = new Set<Phase>();
  for (const workout of workouts) {
    const revised = PROGRAM_DAYS.find((item) => item.date === workout.date);
    if (
      !revised ||
      !["calibration", "volume-1", "volume-2"].includes(revised.phase)
    )
      continue;
    if (
      prescriptionSignature(workout.targets) !==
      prescriptionSignature(createTargets(revised, DEFAULT_SETTINGS))
    ) {
      originalPhases.add(revised.phase);
    }
  }
  return PROGRAM_DAYS.map((item) =>
    originalPhases.has(item.phase)
      ? ORIGINAL_PROGRAM_DAYS.find((original) => original.date === item.date)!
      : item,
  );
}

export interface ScheduleChange {
  date: string;
  before: ProgramDay;
  after: ProgramDay;
}

/** Review only future, unstarted prescriptions; active/historical snapshots stay intact. */
export function previewScheduleChanges(
  workouts: readonly Workout[],
  fromDate = todayDate(),
): ScheduleChange[] {
  const storedDates = new Set(workouts.map((workout) => workout.date));
  return programDaysForWorkouts(workouts).flatMap((after) => {
    if (after.date < fromDate || storedDates.has(after.date)) return [];
    const before = ORIGINAL_PROGRAM_DAYS.find(
      (item) => item.date === after.date,
    )!;
    return prescriptionSignature(createTargets(before, DEFAULT_SETTINGS)) ===
      prescriptionSignature(createTargets(after, DEFAULT_SETTINGS))
      ? []
      : [{ date: after.date, before, after }];
  });
}

export function getProgramDay(
  date: string,
  workouts: readonly Workout[] = [],
): ProgramDay | undefined {
  const saved = workouts.find((workout) => workout.date === date);
  if (saved) {
    const signature = prescriptionSignature(saved.targets);
    const matchingDay = [PROGRAM_DAYS, ORIGINAL_PROGRAM_DAYS]
      .map((days) => days.find((item) => item.date === date))
      .find(
        (item) =>
          item &&
          prescriptionSignature(createTargets(item, DEFAULT_SETTINGS)) ===
            signature,
      );
    if (matchingDay) return matchingDay;
  }
  return programDaysForWorkouts(workouts).find((item) => item.date === date);
}

export function formatRule(
  block: Pick<Block, "percent" | "offsetLb" | "rpeTarget" | "kind">,
): string {
  if (block.percent !== undefined)
    return `${block.percent}% TM${block.offsetLb ? ` + ${block.offsetLb} lb` : ""}`;
  if (block.kind === "calibration")
    return `Calibration single · RPE ${block.rpeTarget}`;
  if (block.kind === "final-single")
    return `Final heavy single · RPE ${block.rpeTarget}`;
  return "Actual weight";
}

export function calculateWorkingWeight(
  block: Pick<Block, "lift" | "percent" | "offsetLb">,
  settings: Settings,
): number | null {
  if (block.percent === undefined) return null;
  const trainingMax = settings.trainingMaxes[block.lift];
  if (!trainingMax) return null;
  const tmLb = convertWeight(trainingMax.weight, trainingMax.unit, "lb");
  const incrementLb = convertWeight(settings.increment, settings.unit, "lb");
  const baselineLb = roundToIncrement(
    (tmLb * block.percent) / 100,
    incrementLb,
  );
  const prescribedLb = baselineLb + (block.offsetLb ?? 0);
  return settings.unit === "lb"
    ? roundUpToLoadablePounds(prescribedLb)
    : convertWeight(prescribedLb, "lb", settings.unit);
}

export function missingTrainingMaxes(
  programDay: ProgramDay,
  settings: Settings,
): Lift[] {
  return LIFTS.filter(
    (lift) =>
      programDay.blocks.some(
        (block) => block.lift === lift && block.percent !== undefined,
      ) && !settings.trainingMaxes[lift],
  );
}

export function createTargets(
  programDay: ProgramDay,
  settings: Settings,
): SetTarget[] {
  return programDay.blocks.flatMap((block) =>
    Array.from({ length: block.sets }, (_, index) => ({
      id: `${block.id}:set:${index + 1}`,
      blockId: block.id,
      lift: block.lift,
      setNumber: index + 1,
      reps: block.reps,
      weight: calculateWorkingWeight(block, settings),
      unit: settings.unit,
      rule: formatRule(block),
      kind: block.kind,
      ...(block.rpeTarget ? { rpeTarget: block.rpeTarget } : {}),
    })),
  );
}

const identity = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function startWorkout(
  programDay: ProgramDay,
  settings: Settings,
  accountId: string,
  now: Date = new Date(),
): Workout {
  const missing = missingTrainingMaxes(programDay, settings);
  if (missing.length)
    throw new Error(
      `Confirm ${missing.map((lift) => LIFT_LABELS[lift].toLowerCase()).join(" and ")} training max${missing.length > 1 ? "es" : ""} before starting this workout.`,
    );
  if (!programDay.blocks.length)
    throw new Error("This day has no prescribed workout.");
  return {
    id: identity(),
    revision: 0,
    date: programDay.date,
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    status: "active",
    targets: createTargets(programDay, settings),
    sets: [],
    notes: "",
    sync: { status: "local" },
    accountId,
    source: "smolov-sbd",
  };
}

export function skipWorkout(
  programDay: ProgramDay,
  settings: Settings,
  accountId: string,
  now: Date = new Date(),
): Workout {
  return {
    id: identity(),
    revision: 1,
    date: programDay.date,
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    finishedAt: now.toISOString(),
    status: "skipped",
    targets: createTargets(programDay, settings),
    sets: [],
    notes: "",
    sync: { status: "local" },
    accountId,
    source: "smolov-sbd",
  };
}

export function prescribedReps(
  days: readonly ProgramDay[],
): Record<Lift, number> & { combined: number } {
  const totals = { squat: 0, bench: 0, deadlift: 0, combined: 0 };
  for (const programDay of days)
    for (const block of programDay.blocks) {
      if (block.kind !== "working") continue;
      totals[block.lift] += block.sets * block.reps;
      totals.combined += block.sets * block.reps;
    }
  return totals;
}

export interface TargetChange {
  date: string;
  blockId: string;
  lift: Lift;
  rule: string;
  before: number | null;
  after: number | null;
  unit: Unit;
}

/** Excludes every day with a stored session, including active workouts. */
export function previewTrainingMaxChange(
  lift: Lift,
  next: TrainingMax | null,
  settings: Settings,
  workouts: readonly Workout[],
  fromDate = todayDate(),
): TargetChange[] {
  const revised: Settings = {
    ...settings,
    trainingMaxes: { ...settings.trainingMaxes, [lift]: next },
  };
  const startedDates = new Set(workouts.map((workout) => workout.date));
  return programDaysForWorkouts(workouts)
    .filter((item) => item.date >= fromDate && !startedDates.has(item.date))
    .flatMap((item) =>
      item.blocks
        .filter((block) => block.lift === lift && block.percent !== undefined)
        .flatMap((block) => {
          const before = calculateWorkingWeight(block, settings);
          const after = calculateWorkingWeight(block, revised);
          return before === after
            ? []
            : [
                {
                  date: item.date,
                  blockId: block.id,
                  lift,
                  rule: formatRule(block),
                  before,
                  after,
                  unit: settings.unit,
                },
              ];
        }),
    );
}

export function validateSet(workout: Workout, logged: LoggedSet): string[] {
  const problems: string[] = [];
  const target = workout.targets.find((item) => item.id === logged.targetId);
  if (!target) return ["This set does not belong to the workout."];
  if (target.lift !== logged.lift)
    problems.push("The logged lift must match its target.");
  if (!Number.isFinite(logged.weight) || logged.weight < 0)
    problems.push("Enter a nonnegative actual weight.");
  if (logged.outcome !== "skipped" && logged.weight === 0)
    problems.push("Enter the actual weight lifted.");
  if (!Number.isInteger(logged.reps) || logged.reps < 0)
    problems.push("Enter nonnegative whole actual reps.");
  if (logged.outcome === "skipped" && logged.reps !== 0)
    problems.push("Skipped sets have zero actual reps.");
  if (logged.outcome === "complete" && logged.reps === 0)
    problems.push("A completed set needs actual reps.");
  if (
    logged.rpe !== undefined &&
    (!Number.isFinite(logged.rpe) || logged.rpe < 1 || logged.rpe > 10)
  )
    problems.push("RPE must be between 1 and 10.");
  if (logged.rpe !== undefined && !target.rpeTarget)
    problems.push(
      "RPE is recorded only for calibration and final heavy singles.",
    );
  if (
    target.rpeTarget &&
    logged.outcome === "complete" &&
    logged.rpe === undefined
  )
    problems.push("Record the achieved RPE for this single.");
  if (!["lb", "kg"].includes(logged.unit))
    problems.push("Choose pounds or kilograms.");
  if (!["complete", "failed", "skipped"].includes(logged.outcome))
    problems.push("Choose a set outcome.");
  if (!isActivityTimestamp(logged.loggedAt))
    problems.push("The logged timestamp must include its time zone.");
  return problems;
}

export function logSet(workout: Workout, logged: LoggedSet): Workout {
  const problems = validateSet(workout, logged);
  if (problems.length) throw new Error(problems.join(" "));
  const previous = workout.sets.find(
    (item) => item.targetId === logged.targetId,
  );
  // Corrections change the saved performance, not when that set took place.
  const nextSet = {
    ...logged,
    id: previous?.id ?? logged.id,
    loggedAt: previous?.loggedAt ?? logged.loggedAt,
  };
  return {
    ...workout,
    revision: workout.revision + 1,
    updatedAt: logged.loggedAt,
    sets: [
      ...workout.sets.filter((item) => item.targetId !== logged.targetId),
      nextSet,
    ],
  };
}

export function undoSet(workout: Workout, targetId: string): Workout {
  return {
    ...workout,
    revision: workout.revision + 1,
    updatedAt: new Date().toISOString(),
    sets: workout.sets.filter((item) => item.targetId !== targetId),
  };
}

export function addWarmup(
  workout: Workout,
  lift: Lift,
  reps = 1,
  weight: number | null = null,
  unit: Unit = "lb",
): Workout {
  const id = `warmup:${identity()}`;
  const setNumber =
    workout.targets.filter(
      (target) => target.kind === "warmup" && target.lift === lift,
    ).length + 1;
  return {
    ...workout,
    revision: workout.revision + 1,
    updatedAt: new Date().toISOString(),
    targets: [
      ...workout.targets,
      {
        id,
        blockId: `warmup:${lift}`,
        lift,
        setNumber,
        reps,
        weight,
        unit,
        rule: "Optional warm-up",
        kind: "warmup",
      },
    ],
  };
}

export function workoutSummary(workout: Workout) {
  const workingTargets = workout.targets.filter(
    (target) => target.kind !== "warmup",
  );
  const workingIds = new Set(workingTargets.map((target) => target.id));
  const prescribedSets = workout.sets.filter((set) =>
    workingIds.has(set.targetId),
  );
  return {
    plannedSets: workingTargets.length,
    loggedSets: prescribedSets.length,
    completedSets: prescribedSets.filter((set) => set.outcome === "complete")
      .length,
    failedSets: prescribedSets.filter((set) => set.outcome === "failed").length,
    skippedSets: prescribedSets.filter((set) => set.outcome === "skipped")
      .length,
    actualReps: prescribedSets.reduce(
      (total, set) => total + (set.outcome === "skipped" ? 0 : set.reps),
      0,
    ),
    completedReps: prescribedSets
      .filter((set) => set.outcome === "complete")
      .reduce((total, set) => total + set.reps, 0),
    warmupSets: workout.sets.filter((set) => !workingIds.has(set.targetId))
      .length,
    remainingSets: workingTargets.length - prescribedSets.length,
  };
}

export function finishWorkout(
  workout: Workout,
  now: Date = new Date(),
): Workout {
  const summary = workoutSummary(workout);
  const completed =
    summary.plannedSets > 0 && summary.completedSets === summary.plannedSets;
  return {
    ...workout,
    revision: workout.revision + 1,
    updatedAt: now.toISOString(),
    status: completed ? "completed" : "partial",
    finishedAt: workout.finishedAt ?? now.toISOString(),
  };
}

/** Explicit calibration confirmation uses the actual successful single, never an estimated 1RM. */
export function confirmCalibrationTrainingMax(
  workout: Workout,
  targetId: string,
  now: Date = new Date(),
): TrainingMax {
  const target = workout.targets.find((item) => item.id === targetId);
  const logged = workout.sets.find((item) => item.targetId === targetId);
  if (
    target?.kind !== "calibration" ||
    !logged ||
    logged.outcome !== "complete" ||
    logged.reps !== 1 ||
    logged.weight <= 0 ||
    logged.rpe === undefined ||
    logged.rpe < 6 ||
    logged.rpe > 8
  ) {
    throw new Error(
      "Confirm a successfully logged calibration single with actual RPE 6–8.",
    );
  }
  return {
    weight: logged.weight,
    unit: logged.unit,
    calibrationRpe: logged.rpe,
    confirmedAt: now.toISOString(),
  };
}

export function meetTotal(attempts: readonly MeetAttempt[], unit: Unit) {
  const best: Record<Lift, number | null> = {
    squat: null,
    bench: null,
    deadlift: null,
  };
  for (const attempt of attempts) {
    if (
      attempt.outcome !== "good" ||
      attempt.weight === null ||
      !Number.isFinite(attempt.weight) ||
      attempt.weight <= 0
    )
      continue;
    const weight = convertWeight(attempt.weight, attempt.unit, unit);
    best[attempt.lift] = Math.max(best[attempt.lift] ?? 0, weight);
  }
  const valid = LIFTS.every((lift) => best[lift] !== null);
  return {
    best,
    valid,
    total: valid
      ? LIFTS.reduce((sum, lift) => sum + (best[lift] ?? 0), 0)
      : null,
    unit,
  };
}

export function emptyMeetAttempts(unit: Unit = "lb"): MeetAttempt[] {
  return LIFTS.flatMap((lift) =>
    ([1, 2, 3] as const).map((number) => ({
      id: `meet:${lift}:${number}`,
      lift,
      number,
      weight: null,
      unit,
      outcome: "not-taken",
      notes: "",
    })),
  );
}
