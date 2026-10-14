export const BODYWEIGHT_KEY = "away-strength:state:v1";
export const BODYWEIGHT_EXERCISES = [
  {
    id: "air-squat",
    name: "Air squats",
    variants: ["Standard", "Comfortable depth", "Paused"],
    cue: "Use a comfortable depth. Keep your feet planted and stand tall.",
  },
  {
    id: "push-up",
    name: "Push-ups",
    variants: ["Floor", "Knees", "Wall", "High incline"],
    cue: "Keep your body in one line. Choose a variation that leaves 2 good reps available. Inclines need a fixed, load-bearing support.",
  },
  {
    id: "glute-bridge",
    name: "Glute bridges",
    variants: ["Standard", "Paused"],
    cue: "Press through your feet and squeeze your glutes. Finish without arching your lower back.",
  },
];
export const OUTCOMES = {
  comfortable: "Comfortable",
  hard: "Hard · repeat",
  repeat: "Comfortable · repeat",
  short: "Stopped early",
  skipped: "Skipped",
};
export const localDay = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export function isDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(+date) && localDay(date) === value;
}
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
const integer = (value, min, max) =>
  Number.isInteger(value) && value >= min && value <= max;
export const maxLevel = (baseReps = 10) => ((20 - baseReps) / 2 + 1) * 3;
export function prescription(level = 1, baseReps = 10) {
  check(
    integer(baseReps, 2, 10) && baseReps % 2 === 0,
    "Starting reps must be 2, 4, 6, 8, or 10.",
  );
  check(
    integer(level, 1, maxLevel(baseReps)),
    "Choose a level within the ladder.",
  );
  return {
    sets: ((level - 1) % 3) + 1,
    reps: baseReps + Math.floor((level - 1) / 3) * 2,
  };
}
export function nextLevel(level, baseReps, outcome) {
  const { sets } = prescription(level, baseReps);
  if (outcome === "comfortable") return Math.min(level + 1, maxLevel(baseReps));
  // A reset always reduces volume. Moving back one index from 1×12 would give 3×10.
  if (outcome === "short") return Math.max(1, level - (sets > 1 ? 1 : 3));
  return level;
}
export function initialBodyweightState() {
  return {
    version: 1,
    revision: 0,
    restSeconds: 90,
    programs: Object.fromEntries(
      BODYWEIGHT_EXERCISES.map((e) => [
        e.id,
        {
          variant: e.variants[0],
          lanes: Object.fromEntries(
            e.variants.map((v) => [v, { baseReps: 10, level: 1 }]),
          ),
        },
      ]),
    ),
    sessions: [],
  };
}
export function validateBodyweightState(state) {
  check(
    state?.version === 1 &&
      integer(state.revision, 0, Number.MAX_SAFE_INTEGER) &&
      integer(state.restSeconds, 30, 300) &&
      Array.isArray(state.sessions) &&
      state.sessions.length <= 10000,
    "This is not a supported Away Strength backup.",
  );
  for (const e of BODYWEIGHT_EXERCISES) {
    const p = state.programs?.[e.id];
    check(
      p && e.variants.includes(p.variant),
      "An exercise variation is invalid.",
    );
    for (const variant of e.variants) {
      const lane = p.lanes?.[variant];
      check(lane, "An exercise level is missing.");
      prescription(lane.level, lane.baseReps);
    }
  }
  const dates = new Set(),
    ids = new Set();
  for (const s of state.sessions) {
    check(
      s &&
        isDay(s.date) &&
        !dates.has(s.date) &&
        typeof s.id === "string" &&
        s.id.length > 0 &&
        s.id.length < 120 &&
        !ids.has(s.id) &&
        typeof s.rest === "boolean" &&
        Array.isArray(s.exercises) &&
        s.exercises.length <= 3,
      "A workout date or identifier is invalid.",
    );
    dates.add(s.date);
    ids.add(s.id);
    check(
      !s.rest || s.exercises.length === 0,
      "A rest day cannot contain workout sets.",
    );
    const moves = new Set();
    for (const entry of s.exercises) {
      const exercise = BODYWEIGHT_EXERCISES.find(
        (e) => e.id === entry.exerciseId,
      );
      check(
        exercise &&
          !moves.has(entry.exerciseId) &&
          exercise.variants.includes(entry.variant),
        "A workout exercise is invalid.",
      );
      moves.add(entry.exerciseId);
      const p = prescription(entry.level, entry.baseReps);
      check(
        Array.isArray(entry.actualReps) &&
          entry.actualReps.length <= p.sets &&
          entry.actualReps.every((n) => integer(n, 0, 99)),
        "Recorded reps are invalid.",
      );
      check(
        entry.outcome === null || Object.hasOwn(OUTCOMES, entry.outcome),
        "A workout result is invalid.",
      );
      check(
        typeof entry.note === "string" && entry.note.length <= 500,
        "A workout note is invalid.",
      );
      const complete =
        entry.actualReps.length === p.sets &&
        entry.actualReps.every((n) => n >= p.reps);
      check(
        !["comfortable", "hard", "repeat"].includes(entry.outcome) || complete,
        "A completed result is missing its prescribed reps.",
      );
      check(
        entry.outcome !== "skipped" || entry.actualReps.length === 0,
        "A skipped exercise cannot contain recorded reps.",
      );
      check(
        entry.outcome !== "short" || entry.actualReps.length > 0,
        "Log the attempted reps before stopping early.",
      );
    }
  }
  return state;
}
export function entryFor(state, date, id) {
  return state.sessions
    .find((s) => s.date === date)
    ?.exercises.find((e) => e.exerciseId === id);
}
export function canEdit(state, date, id) {
  return !state.sessions.some(
    (s) => s.date > date && s.exercises.some((e) => e.exerciseId === id),
  );
}
export function updateBodyweight(state, action, today = localDay()) {
  check(
    isDay(action.date || today) && (action.date || today) <= today,
    "Future workouts cannot be logged.",
  );
  const next = structuredClone(state),
    date = action.date || today;
  next.revision += 1;
  if (action.type === "restSeconds") {
    check(
      integer(action.value, 30, 300),
      "Choose a rest timer from 30 to 300 seconds.",
    );
    next.restSeconds = action.value;
    return next;
  }
  let session = next.sessions.find((s) => s.date === date);
  if (action.type === "rest" || action.type === "unrest") {
    check(
      !session?.exercises.length,
      "Undo the workout entries before marking a rest day.",
    );
    if (action.type === "unrest")
      next.sessions = next.sessions.filter((s) => s.date !== date);
    else if (session) session.rest = true;
    else
      next.sessions.push({
        id: crypto.randomUUID(),
        date,
        rest: true,
        exercises: [],
      });
    return next;
  }
  const exercise = BODYWEIGHT_EXERCISES.find((e) => e.id === action.exerciseId);
  check(exercise, "Unknown exercise.");
  check(
    canEdit(next, date, exercise.id),
    "A newer workout exists for this exercise. Only its latest workout can be edited.",
  );
  const program = next.programs[exercise.id];
  let entry = session?.exercises.find((e) => e.exerciseId === exercise.id);
  if (action.type === "adjust") {
    check(!entry, "Undo this exercise’s entries before changing its setup.");
    check(date === today, "Change exercise setup from Today.");
    check(
      exercise.variants.includes(action.variant),
      "Choose an available variation.",
    );
    prescription(action.level, action.baseReps);
    program.variant = action.variant;
    program.lanes[action.variant] = {
      level: action.level,
      baseReps: action.baseReps,
    };
    return next;
  }
  check(!session?.rest, "Resume training before logging a set.");
  if (!session) {
    session = { id: crypto.randomUUID(), date, rest: false, exercises: [] };
    next.sessions.push(session);
  }
  if (!entry) {
    const lane = program.lanes[program.variant];
    entry = {
      exerciseId: exercise.id,
      variant: program.variant,
      ...lane,
      actualReps: [],
      outcome: null,
      note: "",
    };
    session.exercises.push(entry);
  }
  const lane = program.lanes[entry.variant],
    p = prescription(entry.level, entry.baseReps);
  if (action.type === "undo") {
    if (entry.outcome) {
      check(
        lane.level === nextLevel(entry.level, entry.baseReps, entry.outcome) &&
          lane.baseReps === entry.baseReps,
        "The program was adjusted after this result. Undo is unavailable.",
      );
      program.lanes[entry.variant] = {
        level: entry.level,
        baseReps: entry.baseReps,
      };
      entry.outcome = null;
    } else entry.actualReps.pop();
    if (!entry.actualReps.length)
      session.exercises = session.exercises.filter(
        (e) => e.exerciseId !== exercise.id,
      );
  } else if (action.type === "log") {
    check(
      !entry.outcome && entry.actualReps.length < p.sets,
      "All sets have already been recorded.",
    );
    check(integer(action.reps, 0, 99), "Enter the actual reps, from 0 to 99.");
    entry.actualReps.push(action.reps);
  } else if (action.type === "finish") {
    check(!entry.outcome, "This exercise is already finished today.");
    check(
      Object.hasOwn(OUTCOMES, action.outcome),
      "Choose how the exercise felt.",
    );
    entry.outcome = action.outcome;
    entry.note = String(action.note || "")
      .trim()
      .slice(0, 500);
    lane.level = nextLevel(entry.level, entry.baseReps, entry.outcome);
  } else throw new Error("Unknown workout action.");
  next.sessions = next.sessions.filter((s) => s.rest || s.exercises.length);
  return validateBodyweightState(next);
}
