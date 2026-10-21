import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  ORIGINAL_PROGRAM_DAYS,
  PROGRAM_DAYS,
  addWarmup,
  createTargets,
  prescribedReps,
  skipWorkout,
  startWorkout,
} from "../src/domain/program";
import {
  WEEK_FEELING_ADJUSTMENTS,
  createWeekReview,
  nextTrainingStep,
  programSessionIdForWorkout,
  sessionForWorkout,
  skipSession,
  startSession,
  trainingSessions,
  workoutForSession,
} from "../src/domain/sequence";
import type { Lift, Settings, WeekFeeling, Workout } from "../src/domain/types";

const at = new Date("2026-10-21T14:00:00.000Z");
const config = (): Settings => ({
  ...DEFAULT_SETTINGS,
  trainingMaxes: Object.fromEntries(
    (["squat", "bench", "deadlift"] as const).map((lift) => [lift, {
      weight: 285, unit: "lb", confirmedAt: at.toISOString(),
    }]),
  ) as Settings["trainingMaxes"],
});
const feelings = (feeling: WeekFeeling): Record<Lift, WeekFeeling> => ({
  squat: feeling, bench: feeling, deadlift: feeling,
});
const offsets = (amount: number): Record<Lift, number> => ({ squat: amount, bench: amount, deadlift: amount });
const firstCycle = (now = at): Workout[] => trainingSessions([], config())
  .filter((session) => session.cycle === 1)
  .map((session) => skipSession(session, config(), "local", now));

describe("the undated two-cycle training sequence", () => {
  it("contains two complete three-week cycles, six workouts per week, with stable identities", () => {
    const sessions = trainingSessions([], config());
    expect(sessions).toHaveLength(36);
    expect(new Set(sessions.map((session) => session.id)).size).toBe(36);
    expect(sessions[0]).toMatchObject({
      id: "cycle-1:week-1:session-1", weekId: "cycle-1:week-1", cycle: 1,
      week: 1, sessionNumber: 1, label: "Cycle 1 · Week 1 · Workout 1",
    });
    expect(sessions.at(-1)).toMatchObject({ id: "cycle-2:week-3:session-6", cycle: 2, week: 3 });
    expect(sessions.every((session) => !("date" in session))).toBe(true);
    expect(sessions.map((session) => session.id)).toEqual(trainingSessions([], config()).map((session) => session.id));
    for (const cycle of [1, 2])
      for (const week of [1, 2, 3]) {
        const days = sessions.filter((session) => session.cycle === cycle && session.week === week);
        expect(prescribedReps(days.map((session) => ({ ...session, date: "2026-10-21" })))).toEqual({
          squat: 69, bench: 69, deadlift: 33, combined: 171,
        });
        expect(days.map((session) => session.blocks.map((block) => block.lift))).toEqual([
          ["deadlift"], ["squat", "bench"], ["squat", "bench"],
          ["deadlift", "bench"], ["squat", "bench"], ["squat"],
        ]);
      }
  });

  it("waits for saved progress, even years after the old schedule", () => {
    const step = nextTrainingStep([], config(), new Date("2030-02-15T18:00:00Z"));
    expect(step).toMatchObject({ kind: "workout", session: { id: "cycle-1:week-1:session-1" } });
    const first = skipSession(trainingSessions([], config())[0], config(), "local", at);
    expect(nextTrainingStep([first], config(), new Date("2030-02-15T18:00:00Z"))).toMatchObject({
      kind: "workout", session: { id: "cycle-1:week-1:session-2" },
    });
  });

  it("stores the actual New York activity date and allows two sessions on that date", () => {
    const now = new Date("2027-04-05T02:00:00Z");
    const sessions = trainingSessions([], config());
    const first = skipSession(sessions[0], config(), "local", now);
    const second = startSession(sessions[1], config(), "local", now);
    expect(first.date).toBe("2027-04-04");
    expect(second.date).toBe(first.date);
    expect(second.programSessionId).toBe("cycle-1:week-1:session-2");
    expect(second.startedAt).toBe(now.toISOString());
    expect(second.targets[0].blockId).toBe("2026-10-20:1:squat");
    expect(nextTrainingStep([first, second], config(), now)).toMatchObject({
      kind: "workout", workout: { id: second.id }, session: { sessionNumber: 2 },
    });
  });

  it("resumes an active later session before an earlier unstarted session", () => {
    const active = startSession(trainingSessions([], config())[4], config(), "local", at);
    expect(nextTrainingStep([active], config())).toMatchObject({
      kind: "workout", workout: { id: active.id }, session: { sessionNumber: 5 },
    });
  });

  it("resumes an active historical peak workout without changing its saved targets", () => {
    const peak = startWorkout(PROGRAM_DAYS.find((day) => day.date === "2026-11-04")!, config(), "local", at);
    const before = structuredClone(peak);
    expect(nextTrainingStep([peak], config())).toMatchObject({
      kind: "workout", workout: { id: peak.id }, session: { label: "Saved workout", phase: "peak" },
    });
    expect(sessionForWorkout(peak, [peak], config()).blocks.map((block) => block.kind)).toEqual([
      "final-single", "working", "working",
    ]);
    expect(peak).toEqual(before);
  });
});

describe("legacy workout mapping and calibration", () => {
  it("maps original weeks without mutating history and retains all unstarted original pairings", () => {
    const original = ORIGINAL_PROGRAM_DAYS.find((day) => day.date === "2026-10-19")!;
    const legacy = addWarmup(skipWorkout(original, config(), "local", at), "squat");
    const before = structuredClone(legacy);
    const sessions = trainingSessions([legacy], config());
    expect(programSessionIdForWorkout(legacy)).toBe("cycle-1:week-1:session-1");
    expect(workoutForSession(sessions[0], [legacy])).toBe(legacy);
    expect(sessions.slice(0, 6).map((session) => session.blocks.map((block) => block.lift))).toEqual([
      ["deadlift", "squat"], ["bench"], ["squat", "bench"],
      ["squat", "deadlift"], ["bench"], ["squat", "bench"],
    ]);
    expect(sessions[6].blocks.map((block) => block.lift)).toEqual(["deadlift"]);
    expect(legacy).toEqual(before);
    expect(legacy.programSessionId).toBeUndefined();
  });

  it("does not confuse actual dates of new tagged sessions with old dated prescriptions", () => {
    const session = trainingSessions([], config())[0];
    const saved = skipSession(session, config(), "local", new Date("2026-10-22T14:00:00Z"));
    const sessions = trainingSessions([saved], config());
    expect(sessions[1].blocks.map((block) => block.lift)).toEqual(["squat", "bench"]);
    expect(workoutForSession(sessions[3], [saved])).toBeUndefined();
    expect(nextTrainingStep([saved], config())).toMatchObject({ kind: "workout", session: { sessionNumber: 2 } });
  });

  it("keeps the legacy second-week offsets once that week has begun", () => {
    const legacy = skipWorkout(ORIGINAL_PROGRAM_DAYS.find((day) => day.date === "2026-10-26")!, config(), "local", at);
    const sessions = trainingSessions([legacy], config());
    const week = sessions.filter((session) => session.cycle === 1 && session.week === 2);
    expect(week.every((session) => !session.adjustmentPending)).toBe(true);
    expect(week.flatMap((session) => session.blocks).filter((block) => block.lift !== "deadlift")
      .every((block) => block.offsetLb === 5)).toBe(true);
    expect(week.flatMap((session) => session.blocks).filter((block) => block.lift === "deadlift")
      .every((block) => !block.offsetLb)).toBe(true);
    expect(week[1].blocks.map((block) => block.lift)).toEqual(["bench"]);
  });

  it("offers missing calibration singles and omits unstarted calibration when all TMs are confirmed", () => {
    expect(trainingSessions([], DEFAULT_SETTINGS)[0].blocks.map((block) => block.lift)).toEqual(["squat", "bench", "deadlift"]);
    expect(trainingSessions([], config())[0].kind).toBe("volume");
    const missingBench = config();
    missingBench.trainingMaxes.bench = null;
    expect(trainingSessions([], missingBench)[0].blocks.map((block) => block.lift)).toEqual(["bench"]);
    expect(() => startSession(trainingSessions([], config())[1], missingBench, "local", at)).toThrow(/bench training max/);
  });

  it("preserves an already-started original split and does not repeat saved calibration tests", () => {
    const original = ORIGINAL_PROGRAM_DAYS.find((day) => day.date === "2026-10-14")!;
    const saved = skipWorkout(original, DEFAULT_SETTINGS, "local", at);
    const sessions = trainingSessions([saved], DEFAULT_SETTINGS);
    expect(sessions.filter((session) => session.kind === "calibration").map((session) => session.blocks.map((block) => block.lift)))
      .toEqual([["squat", "bench"], ["deadlift"]]);
    expect(nextTrainingStep([saved], DEFAULT_SETTINGS)).toMatchObject({
      kind: "workout", session: { id: "calibration:2026-10-16" },
    });
    expect(trainingSessions([saved], config()).filter((session) => session.kind === "calibration")).toHaveLength(1);
  });

  it("retains active calibration even after every TM is confirmed and retains saved calibration for review", () => {
    const calibration = trainingSessions([], DEFAULT_SETTINGS)[0];
    const saved = startSession(calibration, DEFAULT_SETTINGS, "local", at);
    expect(nextTrainingStep([saved], config())).toMatchObject({ kind: "workout", workout: { id: saved.id }, session: { kind: "calibration" } });
    expect(trainingSessions([{ ...saved, status: "completed", finishedAt: at.toISOString() }], config())[0].kind).toBe("calibration");
  });
});

describe("weekly feeling reviews", () => {
  it("uses the exact five requested deltas and independent cumulative lift adjustments", () => {
    expect(WEEK_FEELING_ADJUSTMENTS).toEqual({ easy: 15, good: 10, decent: 5, ok: 0, hard: -5 });
    const review = createWeekReview("cycle-1:week-2", { squat: "easy", bench: "decent", deadlift: "hard" }, offsets(0), at);
    expect(review.offsetsLb).toEqual({ squat: 15, bench: 5, deadlift: -5 });
    const next = createWeekReview("cycle-1:week-3", feelings("good"), review.offsetsLb, at);
    expect(next.offsetsLb).toEqual({ squat: 25, bench: 15, deadlift: 5 });
    const sessions = trainingSessions([], config(), [review, next]);
    const third = sessions.filter((session) => session.cycle === 1 && session.week === 3);
    expect(third.every((session) => !session.adjustmentPending)).toBe(true);
    for (const block of third.flatMap((session) => session.blocks))
      expect(block.offsetLb).toBe(next.offsetsLb[block.lift]);
    expect(sessions.find((session) => session.cycle === 2)?.blocks[0].offsetLb).toBe(5);
  });

  it("prompts only at a new week boundary and preserves the review before its first workout", () => {
    const week = trainingSessions([], config()).slice(0, 6).map((session) => skipSession(session, config(), "local", at));
    expect(nextTrainingStep(week.slice(0, 5), config(), at)).toMatchObject({ kind: "workout", session: { sessionNumber: 6 } });
    expect(nextTrainingStep(week, config(), at)).toMatchObject({
      kind: "review", weekId: "cycle-1:week-2", previousOffsetsLb: offsets(0),
    });
    const review = createWeekReview("cycle-1:week-2", feelings("ok"), offsets(0), at);
    expect(nextTrainingStep(week, config(), at, [review])).toMatchObject({
      kind: "workout", session: { id: "cycle-1:week-2:session-1", adjustmentPending: false },
    });
  });

  it("keeps a saved week's target snapshots and carries its prior adjustments into the next review", () => {
    const review = createWeekReview("cycle-1:week-2", { squat: "easy", bench: "decent", deadlift: "hard" }, offsets(0), at);
    const sessions = trainingSessions([], config(), [review]);
    const workouts = sessions.slice(0, 12).map((session) => skipSession(session, config(), "local", at));
    const before = structuredClone(workouts);
    expect(nextTrainingStep(workouts, config(), at, [review])).toMatchObject({
      kind: "review", weekId: "cycle-1:week-3", previousOffsetsLb: { squat: 15, bench: 5, deadlift: -5 },
    });
    expect(trainingSessions(workouts, config(), [review])[6].blocks[0].offsetLb).toBe(-5);
    expect(workouts).toEqual(before);
  });

  it("does not retroactively gate a begun week that predates weekly reviews", () => {
    const workouts = trainingSessions([], config()).slice(0, 7).map((session) => skipSession(session, config(), "local", at));
    expect(nextTrainingStep(workouts, config(), at)).toMatchObject({ kind: "workout", session: { id: "cycle-1:week-2:session-2" } });
  });

  it("carries the third week's cumulative adjustments into the cycle-two review", () => {
    const second = createWeekReview("cycle-1:week-2", feelings("easy"), offsets(0), at);
    const third = createWeekReview("cycle-1:week-3", feelings("good"), second.offsetsLb, at);
    const sessions = trainingSessions([], config(), [second, third]);
    const workouts = sessions.filter((session) => session.cycle === 1)
      .map((session) => skipSession(session, config(), "local", at));
    const afterBreak = new Date("2026-10-28T14:00:00Z");
    expect(nextTrainingStep(workouts, config(), afterBreak, [second, third])).toMatchObject({
      kind: "review", weekId: "cycle-2:week-1", previousOffsetsLb: offsets(25),
    });
    const next = createWeekReview("cycle-2:week-1", feelings("hard"), third.offsetsLb, afterBreak);
    const cycleTwo = trainingSessions(workouts, config(), [second, third, next]).filter((session) => session.cycle === 2 && session.week === 1);
    expect(cycleTwo.flatMap((session) => session.blocks).every((block) => block.offsetLb === 20)).toBe(true);
  });

  it("uses the confirmed previous review for progression while retaining older saved targets", () => {
    const sessions = trainingSessions([], config());
    const workouts = sessions.slice(0, 12).map((session) => skipSession(session, config(), "local", at));
    const original = structuredClone(workouts);
    const review = createWeekReview("cycle-1:week-2", feelings("easy"), offsets(0), at);
    expect(nextTrainingStep(workouts, config(), at, [review])).toMatchObject({
      kind: "review", previousOffsetsLb: offsets(15),
    });
    expect(trainingSessions(workouts, config(), [review])[6].blocks[0].offsetLb).toBeUndefined();
    expect(workouts).toEqual(original);
  });

  it("rejects missing feelings, invalid week identities, and invalid inherited offsets", () => {
    expect(() => createWeekReview("cycle-1:week-1", feelings("good"), offsets(0))).toThrow();
    expect(() => createWeekReview("2026-10-26", feelings("good"), offsets(0))).toThrow();
    expect(() => createWeekReview("cycle-1:week-2", { ...feelings("ok"), squat: "unknown" as WeekFeeling }, offsets(0))).toThrow();
    expect(() => createWeekReview("cycle-1:week-2", feelings("ok"), { ...offsets(0), bench: NaN })).toThrow();
  });
});

describe("the seven-day break and program completion", () => {
  it("starts the break at the latest actual finish in cycle one, including an out-of-order last completion", () => {
    const workouts = firstCycle();
    const latest = new Date("2026-11-03T15:30:00Z");
    workouts[2] = { ...workouts[2], finishedAt: latest.toISOString() };
    expect(nextTrainingStep(workouts, config(), latest)).toMatchObject({
      kind: "recovery", startsAt: latest.toISOString(), endsAt: "2026-11-10T15:30:00.000Z", remainingDays: 7,
    });
    expect(nextTrainingStep(workouts, config(), new Date("2026-11-10T15:29:59Z"))).toMatchObject({ kind: "recovery", remainingDays: 1 });
    expect(nextTrainingStep(workouts, config(), new Date("2026-11-10T15:30:00Z"))).toMatchObject({
      kind: "review", weekId: "cycle-2:week-1",
    });
  });

  it("opens cycle two after recovery and its weekly review, carrying reviewed offsets across the break", () => {
    const workouts = firstCycle();
    const review = createWeekReview("cycle-2:week-1", feelings("easy"), offsets(0), at);
    expect(nextTrainingStep(workouts, config(), new Date("2026-10-28T14:00:00Z"), [review])).toMatchObject({
      kind: "workout", session: { id: "cycle-2:week-1:session-1" },
    });
    expect(nextTrainingStep(workouts, config(), at, [review]).kind).toBe("recovery");
  });

  it("does not relock cycle two if it already has a saved workout", () => {
    const workouts = firstCycle();
    workouts.push(skipSession(trainingSessions([], config())[18], config(), "local", at));
    expect(nextTrainingStep(workouts, config(), at)).toMatchObject({
      kind: "workout", session: { id: "cycle-2:week-1:session-2" },
    });
  });

  it("reports complete when all 36 workouts are saved, preserving every original snapshot", () => {
    const sessions = trainingSessions([], config());
    const workouts = sessions.map((session) => skipSession(session, config(), "local", at));
    const before = structuredClone(workouts);
    expect(nextTrainingStep(workouts, config(), at)).toEqual({ kind: "complete" });
    for (let index = 0; index < sessions.length; index += 1)
      expect(workouts[index].targets).toEqual(createTargets({ ...sessions[index], date: "2026-10-21" }, config()));
    expect(workouts).toEqual(before);
  });
});
