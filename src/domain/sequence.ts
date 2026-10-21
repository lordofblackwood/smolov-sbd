import {
  LIFTS,
  ORIGINAL_PROGRAM_DAYS,
  PROGRAM_DAYS,
  addDays,
  getProgramDay,
  programDaysForWorkouts,
  skipWorkout,
  startWorkout,
  todayDate,
} from "./program";
import type { Block, Lift, Phase, ProgramDay, Settings, WeekFeeling, WeekReview, Workout } from "./types";

export interface TrainingSession {
  id: string;
  label: string;
  kind: "calibration" | "volume";
  cycle?: 1 | 2;
  week?: 1 | 2 | 3;
  weekId?: string;
  adjustmentPending?: boolean;
  sessionNumber: number;
  phase: Phase;
  /** Links a historical dated prescription without assigning a new due date. */
  legacyDate?: string;
  blocks: readonly Block[];
  recovery: string | null;
  optionalAccessories?: string;
}

export type TrainingStep =
  | { kind: "workout"; session: TrainingSession; workout: Workout | undefined }
  | { kind: "review"; weekId: string; session: TrainingSession; previousOffsetsLb: Record<Lift, number> }
  | {
      kind: "recovery";
      startsAt: string;
      endsAt: string;
      remainingDays: number;
      nextSession: TrainingSession;
    }
  | { kind: "complete" };

const RECOVERY_MS = 7 * 24 * 60 * 60 * 1000;

export const WEEK_FEELING_ADJUSTMENTS: Record<WeekFeeling, number> = {
  easy: 15,
  good: 10,
  decent: 5,
  ok: 0,
  hard: -5,
};
export const WEEK_FEELING_LABELS: Record<WeekFeeling, string> = {
  easy: "Easy",
  good: "Good",
  decent: "Decent",
  ok: "OK",
  hard: "Hard",
};

export function createWeekReview(
  weekId: string,
  feelings: Record<Lift, WeekFeeling>,
  previousOffsetsLb: Record<Lift, number>,
  now: Date = new Date(),
): WeekReview {
  if (!/^cycle-[12]:week-[123]$/.test(weekId) || weekId === "cycle-1:week-1")
    throw new Error("Choose a new training week for this review.");
  const offsetsLb = {} as Record<Lift, number>;
  for (const lift of LIFTS) {
    if (!Object.hasOwn(WEEK_FEELING_ADJUSTMENTS, feelings[lift]))
      throw new Error(`Choose how ${lift} felt before confirming the week.`);
    if (!Number.isFinite(previousOffsetsLb[lift]))
      throw new Error("Previous week adjustments must be valid numbers.");
    offsetsLb[lift] = previousOffsetsLb[lift] + WEEK_FEELING_ADJUSTMENTS[feelings[lift]];
  }
  return { weekId, feelings: { ...feelings }, offsetsLb, reviewedAt: now.toISOString() };
}

/** A read-only identity bridge; historical workouts and outbox payloads stay intact. */
export function programSessionIdForWorkout(
  workout: Workout,
  _allWorkouts: readonly Workout[] = [],
): string | undefined {
  if (workout.programSessionId) return workout.programSessionId;
  const targets = workout.targets.filter((target) => target.kind !== "warmup");
  if (
    ["2026-10-14", "2026-10-16"].includes(workout.date) &&
    targets.some((target) => target.kind === "calibration")
  )
    return `calibration:${workout.date}`;
  if (!targets.some((target) => target.kind === "working")) return undefined;
  for (const [week, start] of [[1, "2026-10-19"], [2, "2026-10-26"]] as const)
    for (let index = 0; index < 6; index += 1)
      if (workout.date === addDays(start, index))
        return `cycle-1:week-${week}:session-${index + 1}`;
  return undefined;
}

export function workoutForSession(
  session: TrainingSession,
  workouts: readonly Workout[],
): Workout | undefined {
  return workouts.find((workout) => workout.programSessionId === session.id) ??
    workouts.find(
      (workout) =>
        !workout.programSessionId &&
        programSessionIdForWorkout(workout, workouts) === session.id,
    );
}

/** Saved target snapshots also describe active legacy sessions outside this plan. */
function snapshotBlocks(workout: Workout): readonly Block[] {
  const groups = new Map<string, Workout["targets"]>();
  for (const target of workout.targets) {
    if (target.kind === "warmup") continue;
    const group = groups.get(target.blockId) ?? [];
    group.push(target);
    groups.set(target.blockId, group);
  }
  return [...groups].map(([id, targets]) => {
    const target = targets[0];
    const rule = /^(\d+(?:\.\d+)?)% TM(?: ([+−-]) (-?\d+(?:\.\d+)?) lb)?$/.exec(target.rule);
    return {
      id,
      lift: target.lift,
      sets: targets.length,
      reps: target.reps,
      kind: target.kind as Block["kind"],
      ...(rule ? { percent: Number(rule[1]) } : {}),
      ...(rule?.[3] ? { offsetLb: Number(rule[3]) * (rule[2] === "+" ? 1 : -1) } : {}),
      ...(target.rpeTarget ? { rpeTarget: target.rpeTarget } : {}),
    };
  });
}

function withSnapshot(
  session: TrainingSession,
  workouts: readonly Workout[],
): TrainingSession {
  const saved = workoutForSession(session, workouts);
  return saved ? { ...session, blocks: snapshotBlocks(saved) } : session;
}

/** Six workouts per week; advancing depends on saved sessions, never the calendar. */
export function trainingSessions(
  workouts: readonly Workout[],
  settings: Settings,
  weekReviews: readonly WeekReview[] = [],
): TrainingSession[] {
  // A new session's actual activity date must never be mistaken for an old due date.
  const legacy = workouts.filter((workout) => !workout.programSessionId);
  const effective = programDaysForWorkouts(legacy);
  const originalCalibration = workouts.some((workout) => {
    const id = programSessionIdForWorkout(workout, workouts);
    if (id === "calibration:2026-10-14") return true;
    return id === "calibration:2026-10-16" &&
      workout.targets.filter((target) => target.kind === "calibration").length === 1 &&
      workout.targets.some((target) => target.kind === "calibration" && target.lift === "deadlift");
  });
  const calibrationDays = originalCalibration ? ORIGINAL_PROGRAM_DAYS : effective;
  const savedCalibrationLifts = new Set(
    workouts.flatMap((workout) => workout.targets
      .filter((target) => target.kind === "calibration")
      .map((target) => target.lift)),
  );
  const sessions: TrainingSession[] = [];
  for (const day of calibrationDays.filter((day) => day.phase === "calibration" && day.blocks.length)) {
    const session: TrainingSession = {
      id: `calibration:${day.date}`,
      label: "Initial calibration",
      kind: "calibration",
      sessionNumber: sessions.length + 1,
      phase: "calibration",
      legacyDate: day.date,
      blocks: day.blocks,
      recovery: day.recovery,
    };
    const saved = workoutForSession(session, workouts);
    if (saved) {
      sessions.push(withSnapshot(session, workouts));
      continue;
    }
    const blocks = day.blocks.filter((block) =>
      !settings.trainingMaxes[block.lift] && !savedCalibrationLifts.has(block.lift));
    if (blocks.length) sessions.push({ ...session, blocks });
  }

  let priorOffsets: Record<Lift, number> = { squat: 0, bench: 0, deadlift: 0 };
  for (const cycle of [1, 2] as const)
    for (const week of [1, 2, 3] as const) {
      const weekId = `cycle-${cycle}:week-${week}`;
      const weekWorkouts = workouts.filter((workout) =>
        programSessionIdForWorkout(workout, workouts)?.startsWith(`${weekId}:session-`));
      const review = weekReviews.find((item) => item.weekId === weekId);
      const hasLegacy = weekWorkouts.some((workout) => !workout.programSessionId);
      const offsets: Record<Lift, number> = review ? { ...review.offsetsLb } : {
        ...priorOffsets,
        ...(hasLegacy && cycle === 1 && week === 2 ? { squat: 5, bench: 5, deadlift: 0 } : {}),
      };
      // Preserve a begun week's own rules if it predates weekly reviews.
      if (!review && weekWorkouts.length)
        for (const lift of LIFTS) {
          const savedBlock = weekWorkouts.flatMap(snapshotBlocks).find((block) =>
            block.lift === lift && block.percent !== undefined);
          if (savedBlock) offsets[lift] = savedBlock.offsetLb ?? 0;
        }
      const adjustmentPending = !(cycle === 1 && week === 1) && !review && !weekWorkouts.length;
      for (let index = 0; index < 6; index += 1) {
        const id = `cycle-${cycle}:week-${week}:session-${index + 1}`;
        const legacyDate = cycle === 1 && week < 3
          ? addDays(week === 1 ? "2026-10-19" : "2026-10-26", index)
          : undefined;
        const source = legacyDate
          ? effective.find((day) => day.date === legacyDate)!
          : PROGRAM_DAYS.find((day) => day.date === addDays("2026-10-19", index))!;
        const blocks = source.blocks.map((block, blockIndex) => {
          const { offsetLb: _previousOffset, ...base } = block;
          return {
            ...base,
            id: legacyDate ? block.id : `${id}:${blockIndex + 1}:${block.lift}`,
            ...(offsets[block.lift] ? { offsetLb: offsets[block.lift] } : {}),
          };
        });
        sessions.push(withSnapshot({
          id,
          label: `Cycle ${cycle} · Week ${week} · Workout ${index + 1}`,
          kind: "volume",
          cycle,
          week,
          weekId,
          adjustmentPending,
          sessionNumber: index + 1,
          phase: week === 2 ? "volume-2" : "volume-1",
          ...(legacyDate ? { legacyDate } : {}),
          blocks,
          recovery: null,
          ...(source.optionalAccessories ? { optionalAccessories: source.optionalAccessories } : {}),
        }, workouts));
      }
      priorOffsets = offsets;
    }
  return sessions;
}

export function sessionForWorkout(
  workout: Workout,
  workouts: readonly Workout[],
  settings: Settings,
  weekReviews: readonly WeekReview[] = [],
): TrainingSession {
  const id = programSessionIdForWorkout(workout, workouts);
  const matched = trainingSessions(workouts, settings, weekReviews).find((session) => session.id === id);
  if (matched) return { ...matched, blocks: snapshotBlocks(workout) };
  const oldDay = getProgramDay(workout.date, workouts.filter((item) => !item.programSessionId));
  return {
    id: id ?? `saved:${workout.id}`,
    label: "Saved workout",
    kind: workout.targets.some((target) => target.kind === "calibration") ? "calibration" : "volume",
    sessionNumber: 0,
    phase: oldDay?.phase ?? "volume-1",
    legacyDate: workout.date,
    blocks: snapshotBlocks(workout),
    recovery: null,
    ...(oldDay?.optionalAccessories ? { optionalAccessories: oldDay.optionalAccessories } : {}),
  };
}

export function nextTrainingStep(
  workouts: readonly Workout[],
  settings: Settings,
  now: Date = new Date(),
  weekReviews: readonly WeekReview[] = [],
): TrainingStep {
  const active = workouts.find((workout) => workout.status === "active");
  if (active)
    return { kind: "workout", session: sessionForWorkout(active, workouts, settings, weekReviews), workout: active };
  const sessions = trainingSessions(workouts, settings, weekReviews);
  const next = sessions.find((session) => !workoutForSession(session, workouts));
  if (!next) return { kind: "complete" };
  if (next.cycle === 2 && !sessions.some((session) => session.cycle === 2 && workoutForSession(session, workouts))) {
    const finishes = sessions
      .filter((session) => session.cycle === 1)
      .map((session) => workoutForSession(session, workouts))
      .filter((workout): workout is Workout => !!workout)
      .map((workout) => Date.parse(workout.finishedAt ?? workout.updatedAt));
    const boundary = Math.max(...finishes);
    const ends = boundary + RECOVERY_MS;
    if (Number.isFinite(boundary) && now.valueOf() < ends)
      return {
        kind: "recovery",
        startsAt: new Date(boundary).toISOString(),
        endsAt: new Date(ends).toISOString(),
        remainingDays: Math.ceil((ends - now.valueOf()) / (24 * 60 * 60 * 1000)),
        nextSession: next,
      };
  }
  if (next.adjustmentPending && next.weekId) {
    const firstIndex = sessions.findIndex((session) => session.weekId === next.weekId);
    const previous = sessions.slice(0, firstIndex).reverse().find((session) => session.kind === "volume");
    const previousOffsetsLb: Record<Lift, number> = { squat: 0, bench: 0, deadlift: 0 };
    const previousReview = weekReviews.find((review) => review.weekId === previous?.weekId);
    if (previousReview) Object.assign(previousOffsetsLb, previousReview.offsetsLb);
    else if (previous?.weekId)
      for (const lift of LIFTS) {
        const block = sessions.filter((session) => session.weekId === previous.weekId)
          .flatMap((session) => session.blocks).find((block) => block.lift === lift);
        previousOffsetsLb[lift] = block?.offsetLb ?? 0;
      }
    return { kind: "review", weekId: next.weekId, session: next, previousOffsetsLb };
  }
  return { kind: "workout", session: next, workout: undefined };
}

function sessionDay(session: TrainingSession, now: Date): ProgramDay {
  return {
    date: todayDate(now),
    phase: session.phase,
    blocks: session.blocks,
    recovery: session.recovery,
    ...(session.optionalAccessories ? { optionalAccessories: session.optionalAccessories } : {}),
  };
}

export function startSession(
  session: TrainingSession,
  settings: Settings,
  accountId: string,
  now: Date = new Date(),
): Workout {
  return { ...startWorkout(sessionDay(session, now), settings, accountId, now), programSessionId: session.id };
}

export function skipSession(
  session: TrainingSession,
  settings: Settings,
  accountId: string,
  now: Date = new Date(),
): Workout {
  return { ...skipWorkout(sessionDay(session, now), settings, accountId, now), programSessionId: session.id };
}
