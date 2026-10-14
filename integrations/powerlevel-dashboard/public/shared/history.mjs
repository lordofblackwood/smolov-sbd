import {
  BODYWEIGHT_KEY,
  BODYWEIGHT_EXERCISES,
  validateBodyweightState,
} from "./bodyweight.mjs";
export const SOURCE_KEYS = {
  bulgarian: "auto-bulgarian:state:v2",
  accessory: "accessory-lift-tracker-v1",
  bodyweight: BODYWEIGHT_KEY,
  smolov: "smolov-sbd:encrypted-history:v1",
};
export const SOURCE_NAMES = {
  bulgarian: "Auto Bulgarian",
  accessory: "Accessory Lifts",
  bodyweight: "Away Strength",
  smolov: "Smolov SBD",
};
export const LIFTS = {
  backSquat: "Back Squat",
  benchPress: "Bench Press",
  deadlift: "Deadlift",
};
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function dateValid(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00`);
  return !isNaN(d) && localDate(d) === s;
}
export function shiftDate(s, days) {
  const d = new Date(`${s}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDate(d);
}
export function monday(s) {
  const d = new Date(`${s}T12:00:00`);
  return shiftDate(s, -((d.getDay() + 6) % 7));
}
const finite = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
function check(ok, message) {
  if (!ok) throw new Error(message);
}
export function normalizeHistory(source, raw) {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  check(
    value && typeof value === "object",
    "The tracker has no readable history.",
  );
  const events = [];
  if (source === "bulgarian") {
    check(
      value.schemaVersion === 2 && value.lifts,
      "Update Auto Bulgarian before connecting it.",
    );
    for (const [lift, name] of Object.entries(LIFTS)) {
      check(
        Array.isArray(value.lifts[lift]?.history),
        `Missing ${name} history.`,
      );
      value.lifts[lift].history.forEach((h) => {
        check(
          h &&
            typeof h.id === "string" &&
            dateValid(h.actualResultDate) &&
            finite(h.topWeight) &&
            ["completed", "failed"].includes(h.result),
          "An Auto Bulgarian record is invalid.",
        );
        events.push({
          id: `bulgarian:${lift}:${h.id}`,
          source,
          date: h.actualResultDate,
          exercise: lift,
          name,
          success: h.result === "completed",
          singleCompleted:
            h.result === "completed" || h.topSingleCompleted === true,
          weight: h.topWeight,
          unit: "lb",
          sets: 1,
          reps: 1,
          // Only completed backoff work is evidence; prescriptions alone are not.
          ...(h.result === "completed" &&
          h.backoffWorkCompleted !== false &&
          finite(h.backoffWeight) &&
          h.backoffWeight > 0 &&
          Number.isInteger(h.backoffSets) &&
          h.backoffSets > 0 &&
          Number.isInteger(h.backoffReps) &&
          h.backoffReps >= 2 &&
          h.backoffReps <= 10
            ? { repSet: { weight: h.backoffWeight, reps: h.backoffReps } }
            : {}),
          outcome: h.result,
          countsDay: true,
        });
      });
    }
  } else if (source === "accessory") {
    check(
      Array.isArray(value.sessions) && Array.isArray(value.exercises),
      "This is not Accessory Lift Tracker data.",
    );
    check(
      value.version == null ||
        (Number.isInteger(value.version) &&
          value.version >= 1 &&
          value.version <= 4),
      "Update Powerlevel to read this Accessory Lifts version.",
    );
    value.sessions.forEach((s) => {
      check(
        s &&
          typeof s.id === "string" &&
          dateValid(s.date) &&
          Array.isArray(s.exercises),
        "An accessory session is invalid.",
      );
      s.exercises.forEach((e, i) => {
        check(
          e &&
            typeof e.name === "string" &&
            ["success", "failure", "skipped"].includes(e.outcome),
          "An accessory result is invalid.",
        );
        const match = String(e.weight).match(
          /^\s*(\d+(?:\.\d+)?)\s*(lb|lbs|kg|seconds?|secs?|s)?\s*$/i,
        );
        events.push({
          id: `accessory:${s.id}:${e.exerciseId || i}`,
          source,
          date: s.date,
          exercise: String(e.exerciseId || e.name),
          name: e.name.slice(0, 120),
          success: e.outcome === "success",
          singleCompleted: false,
          weight: match ? Number(match[1]) : null,
          unit: match
            ? match[2]?.toLowerCase().startsWith("k")
              ? "kg"
              : /^(s|sec|second)/i.test(match[2] || "")
                ? "sec"
                : "lb"
            : "level",
          weightLabel: String(e.weight).slice(0, 80),
          sets: finite(e.sets) ? e.sets : null,
          reps: finite(e.reps) ? e.reps : null,
          outcome: e.outcome,
          countsDay: e.outcome !== "skipped",
        });
      });
    });
  } else if (source === "bodyweight") {
    validateBodyweightState(value);
    for (const session of value.sessions)
      for (const entry of session.exercises) {
        const exercise = BODYWEIGHT_EXERCISES.find(
          (e) => e.id === entry.exerciseId,
        );
        events.push({
          id: `bodyweight:${session.id}:${entry.exerciseId}`,
          source,
          date: session.date,
          exercise: entry.exerciseId,
          name: exercise.name,
          variant: entry.variant,
          success: ["comfortable", "hard", "repeat"].includes(entry.outcome),
          singleCompleted: false,
          weight: null,
          unit: "reps",
          sets: entry.actualReps.length,
          reps: null,
          actualReps: [...entry.actualReps],
          totalReps: entry.actualReps.reduce((sum, n) => sum + n, 0),
          outcome: entry.outcome || "in-progress",
          countsDay: entry.actualReps.some((n) => n > 0),
        });
      }
  } else throw new Error("Unknown workout tracker.");
  const unique = new Map();
  for (const e of events) {
    if (
      unique.has(e.id) &&
      JSON.stringify(unique.get(e.id)) !== JSON.stringify(e)
    )
      throw new Error("Conflicting duplicate history records.");
    unique.set(e.id, e);
  }
  return {
    schema: 1,
    source,
    events: [...unique.values()].sort(
      (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    ),
  };
}
export function validateSnapshot(s, source) {
  check(
    Object.hasOwn(SOURCE_KEYS, source) &&
      s?.schema === 1 &&
      s.source === source &&
      Array.isArray(s.events) &&
      s.events.length <= 100000,
    "The synced history format is invalid.",
  );
  const ids = new Set();
  if (source === "smolov") {
    check(s.contract === "smolov-v1" && Array.isArray(s.sessions), "Unsupported Smolov snapshot contract.");
    const sessionIds = new Set();
    for (const session of s.sessions) {
      check(session && typeof session.id === "string" && !sessionIds.has(session.id) && Number.isInteger(session.revision) && session.revision >= 1 && dateValid(session.trainingDate) && dateValid(session.scheduledDate) && typeof session.startedAt === "string" && /(Z|[+-]\d{2}:\d{2})$/.test(session.startedAt) && Number.isFinite(Date.parse(session.startedAt)) && typeof session.updatedAt === "string" && /(Z|[+-]\d{2}:\d{2})$/.test(session.updatedAt) && Number.isFinite(Date.parse(session.updatedAt)) && ["completed", "partial", "skipped"].includes(session.status) && typeof session.notes === "string", "Invalid Smolov session revision.");
      if (session.finishedAt !== undefined) check(typeof session.finishedAt === "string" && /(Z|[+-]\d{2}:\d{2})$/.test(session.finishedAt) && Number.isFinite(Date.parse(session.finishedAt)), "Invalid Smolov finish timestamp.");
      sessionIds.add(session.id);
    }
    check(s.sessions.length <= 10000 && s.events.every(event => sessionIds.has(event.sessionId)), "Missing Smolov session identity.");
  }
  for (const e of s.events) {
    check(
      e &&
        typeof e.id === "string" &&
        !ids.has(e.id) &&
        e.source === source &&
        dateValid(e.date) &&
        typeof e.name === "string" &&
        typeof e.exercise === "string" &&
        typeof e.success === "boolean" &&
        typeof e.singleCompleted === "boolean" &&
        typeof e.countsDay === "boolean" &&
        (e.weight === null || finite(e.weight)) &&
        ["lb", "kg", "sec", "level", "reps"].includes(e.unit),
      "A synced record is invalid.",
    );
    if (source === "bulgarian")
      check(
        e.exercise in LIFTS && e.unit === "lb" && finite(e.weight),
        "Invalid synced lift.",
      );
    if (source === "smolov") {
      const session = s.sessions.find(session => session.id === e.sessionId);
      check(Object.hasOwn(LIFTS, e.exercise) && e.unit === "lb" && typeof e.setId === "string" && e.revision === session.revision && typeof e.occurredAt === "string" && /(Z|[+-]\d{2}:\d{2})$/.test(e.occurredAt) && Number.isFinite(Date.parse(e.occurredAt)) && ["completed", "failed", "skipped"].includes(e.outcome) && ["working", "calibration", "final-single", "warmup", "meet-attempt"].includes(e.kind) && e.sets === 1 && Number.isInteger(e.reps) && e.reps >= 0 && e.reps <= 1000 && typeof e.notes === "string" && typeof e.pain === "boolean" && ["lb", "kg"].includes(e.originalUnit), "Invalid Smolov set evidence.");
      check(e.outcome === "skipped" ? e.weight === null && e.originalWeight === null && e.reps === 0 && !e.success && !e.singleCompleted && !e.countsDay : finite(e.weight) && finite(e.originalWeight) && e.success === (e.outcome === "completed" && e.reps > 0) && e.singleCompleted === (e.success && e.reps === 1 && e.kind !== "warmup") && e.countsDay === (e.reps > 0 || e.outcome === "failed"), "Smolov actual evidence does not match its outcome.");
      if (e.rpe !== undefined) check(["calibration", "final-single"].includes(e.kind) && e.outcome !== "skipped" && typeof e.rpe === "number" && Number.isFinite(e.rpe) && e.rpe >= 0 && e.rpe <= 10, "Invalid Smolov RPE.");
      if (e.variant !== undefined) check(typeof e.variant === "string" && e.variant.length <= 120, "Invalid Smolov lift variant.");
      if (e.attemptNumber !== undefined) check(e.kind === "meet-attempt" && [1, 2, 3].includes(e.attemptNumber), "Invalid meet attempt number.");
    }
    if (e.repSet !== undefined)
      check(
        source === "bulgarian" &&
          e.success &&
          e.outcome === "completed" &&
          e.singleCompleted &&
          e.repSet &&
          finite(e.repSet.weight) &&
          e.repSet.weight > 0 &&
          Number.isInteger(e.repSet.reps) &&
          e.repSet.reps >= 2 &&
          e.repSet.reps <= 10,
        "Invalid synced rep-set evidence.",
      );
    if (source === "bodyweight") {
      const definition = BODYWEIGHT_EXERCISES.find((x) => x.id === e.exercise);
      check(
        definition &&
          definition.variants.includes(e.variant) &&
          e.unit === "reps" &&
          e.weight === null &&
          !e.singleCompleted &&
          Array.isArray(e.actualReps) &&
          e.actualReps.length <= 3 &&
          e.actualReps.every((n) => Number.isInteger(n) && n >= 0 && n <= 99) &&
          e.sets === e.actualReps.length &&
          e.reps === null &&
          e.totalReps === e.actualReps.reduce((sum, n) => sum + n, 0) &&
          [
            "comfortable",
            "hard",
            "repeat",
            "short",
            "skipped",
            "in-progress",
          ].includes(e.outcome) &&
          e.countsDay === e.actualReps.some((n) => n > 0) &&
          e.success === ["comfortable", "hard", "repeat"].includes(e.outcome),
        "Invalid synced bodyweight record.",
      );
    }
    ids.add(e.id);
  }
  return s;
}
