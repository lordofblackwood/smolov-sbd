import type { LoggedSet, SetTarget, Workout } from "../domain/types";
import type { AppState } from "./types";
import { SCHEMA_VERSION } from "./types";

type JsonRecord = Record<string, unknown>;
const UNITS = ["lb", "kg"];
const LIFTS = ["squat", "bench", "deadlift"];
const SYNC_STATUSES = [
  "local",
  "pending",
  "synced",
  "failed",
  "needs-attention",
];

export class DataValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataValidationError";
  }
}

function fail(path: string, message: string): never {
  throw new DataValidationError(`${path}: ${message}`);
}

function record(
  value: unknown,
  path: string,
  required: string[],
  optional: string[] = [],
): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(path, "must be an object");
  const object = value as JsonRecord;
  const permitted = new Set([...required, ...optional]);
  for (const key of Object.keys(object))
    if (!permitted.has(key)) fail(`${path}.${key}`, "unrecognized field");
  for (const key of required)
    if (!Object.hasOwn(object, key)) fail(`${path}.${key}`, "is required");
  return object;
}

function string(
  value: unknown,
  path: string,
  max = 20_000,
  nonempty = false,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (nonempty && !value.trim())
  )
    fail(
      path,
      `must be ${nonempty ? "a nonempty" : "a"} string of at most ${max} characters`,
    );
}

function id(value: unknown, path: string, max = 200): asserts value is string {
  string(value, path, max, true);
  if (/[\u0000-\u001f]/.test(value))
    fail(path, "must not contain control characters");
}

export function validateAccountId(value: unknown): asserts value is string {
  id(value, "accountId");
}

function number(
  value: unknown,
  path: string,
  min = 0,
  max = 1_000_000,
  integer = false,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    fail(
      path,
      `must be ${integer ? "a whole number" : "a finite number"} between ${min} and ${max}`,
    );
}

function bool(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== "boolean") fail(path, "must be true or false");
}

function choice(
  value: unknown,
  values: readonly string[],
  path: string,
): asserts value is string {
  if (typeof value !== "string" || !values.includes(value))
    fail(path, `must be one of ${values.join(", ")}`);
}

function timestamp(value: unknown, path: string): asserts value is string {
  string(value, path, 40, true);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    fail(path, "must be an ISO timestamp with a timezone");
  dateOnly(value.slice(0, 10), path);
}

export function validateActivityTimestamp(
  value: unknown,
  path = "timestamp",
): asserts value is string {
  timestamp(value, path);
}

function dateOnly(value: unknown, path: string): void {
  string(value, path, 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    fail(path, "must be a date in YYYY-MM-DD form");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    fail(path, "must be a valid calendar date");
}

function array(value: unknown, path: string, max = 10_000): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    fail(path, `must be an array of at most ${max} entries`);
  return value;
}

function unique(
  items: unknown[],
  key: (item: JsonRecord) => string,
  path: string,
): void {
  const ids = new Set<string>();
  for (const item of items) {
    const identifier = key(item as JsonRecord);
    if (ids.has(identifier)) fail(path, `duplicate identity ${identifier}`);
    ids.add(identifier);
  }
}

function jsonValue(value: unknown, path: string, depth = 0): void {
  if (depth > 12) fail(path, "nested service result is too deep");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    string(value, path);
    return;
  }
  if (typeof value === "number") {
    number(value, path, -1e15, 1e15);
    return;
  }
  if (Array.isArray(value)) {
    array(value, path, 1000).forEach((item, i) =>
      jsonValue(item, `${path}[${i}]`, depth + 1),
    );
    return;
  }
  if (!value || typeof value !== "object")
    fail(path, "must contain only JSON values");
  for (const [key, item] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key))
      fail(path, "unsafe object key");
    jsonValue(item, `${path}.${key}`, depth + 1);
  }
}

function validateTarget(value: unknown, path: string): void {
  const target = record(
    value,
    path,
    [
      "id",
      "blockId",
      "lift",
      "setNumber",
      "reps",
      "weight",
      "unit",
      "rule",
      "kind",
    ],
    ["rpeTarget"],
  );
  id(target.id, `${path}.id`);
  id(target.blockId, `${path}.blockId`);
  choice(target.lift, LIFTS, `${path}.lift`);
  choice(target.unit, UNITS, `${path}.unit`);
  number(target.setNumber, `${path}.setNumber`, 1, 1000, true);
  number(target.reps, `${path}.reps`, 1, 1000, true);
  if (target.weight !== null)
    number(target.weight, `${path}.weight`, 0, 100_000);
  string(target.rule, `${path}.rule`, 1000, true);
  choice(
    target.kind,
    ["working", "calibration", "final-single", "warmup"],
    `${path}.kind`,
  );
  if (target.rpeTarget !== undefined) {
    string(target.rpeTarget, `${path}.rpeTarget`, 100, true);
    if (!["calibration", "final-single"].includes(target.kind))
      fail(`${path}.rpeTarget`, "RPE belongs only to designated singles");
  }
  if (
    ["calibration", "final-single"].includes(target.kind) &&
    (target.reps !== 1 || !target.rpeTarget)
  )
    fail(path, "designated singles require one rep and an RPE target");
}

function validateLoggedSet(
  value: unknown,
  target: SetTarget | undefined,
  path: string,
): void {
  const set = record(
    value,
    path,
    [
      "id",
      "targetId",
      "lift",
      "weight",
      "unit",
      "reps",
      "outcome",
      "notes",
      "pain",
      "loggedAt",
    ],
    ["rpe"],
  );
  id(set.id, `${path}.id`);
  id(set.targetId, `${path}.targetId`);
  choice(set.lift, LIFTS, `${path}.lift`);
  choice(set.unit, UNITS, `${path}.unit`);
  number(set.weight, `${path}.weight`, 0, 100_000);
  number(set.reps, `${path}.reps`, 0, 1000, true);
  choice(set.outcome, ["complete", "failed", "skipped"], `${path}.outcome`);
  string(set.notes, `${path}.notes`);
  bool(set.pain, `${path}.pain`);
  timestamp(set.loggedAt, `${path}.loggedAt`);
  if (!target || target.lift !== set.lift)
    fail(path, "must belong to a matching target in this workout");
  if (set.outcome === "skipped" && set.reps !== 0)
    fail(path, "skipped sets must have zero performed reps");
  if (set.outcome !== "skipped" && set.weight <= 0)
    fail(path, "performed sets require a positive actual weight");
  if (set.outcome === "complete" && set.reps === 0)
    fail(path, "completed sets require performed reps");
  if (set.rpe !== undefined) {
    number(set.rpe, `${path}.rpe`, 1, 10);
    if (!target.rpeTarget)
      fail(`${path}.rpe`, "RPE belongs only to designated singles");
  }
  if (target.rpeTarget && set.outcome === "complete" && set.rpe === undefined)
    fail(path, "a completed designated single requires actual RPE");
}

function validateWorkout(
  value: unknown,
  path: string,
  accountId?: string,
): void {
  const workout = record(
    value,
    path,
    [
      "id",
      "date",
      "startedAt",
      "updatedAt",
      "revision",
      "status",
      "targets",
      "sets",
      "notes",
      "sync",
      "accountId",
    ],
    ["finishedAt", "source"],
  );
  id(workout.id, `${path}.id`);
  id(workout.accountId, `${path}.accountId`);
  if (accountId !== undefined && workout.accountId !== accountId)
    fail(`${path}.accountId`, "belongs to a different account");
  dateOnly(workout.date, `${path}.date`);
  timestamp(workout.startedAt, `${path}.startedAt`);
  timestamp(workout.updatedAt, `${path}.updatedAt`);
  if (workout.finishedAt !== undefined)
    timestamp(workout.finishedAt, `${path}.finishedAt`);
  number(
    workout.revision,
    `${path}.revision`,
    0,
    Number.MAX_SAFE_INTEGER,
    true,
  );
  choice(
    workout.status,
    ["active", "completed", "partial", "skipped"],
    `${path}.status`,
  );
  if (workout.status !== "active" && workout.finishedAt === undefined)
    fail(path, "finished sessions require a finish timestamp");
  string(workout.notes, `${path}.notes`);
  if (workout.source !== undefined)
    string(workout.source, `${path}.source`, 200, true);
  const targets = array(workout.targets, `${path}.targets`, 1000);
  targets.forEach((target, i) =>
    validateTarget(target, `${path}.targets[${i}]`),
  );
  unique(targets, (item) => String(item.id), `${path}.targets`);
  const targetMap = new Map(
    (targets as SetTarget[]).map((target) => [target.id, target]),
  );
  const sets = array(workout.sets, `${path}.sets`, 1000);
  sets.forEach((set, i) =>
    validateLoggedSet(
      set,
      targetMap.get((set as LoggedSet)?.targetId),
      `${path}.sets[${i}]`,
    ),
  );
  unique(sets, (item) => String(item.id), `${path}.sets`);
  unique(sets, (item) => String(item.targetId), `${path}.sets`);
  if (workout.status === "completed") {
    const required = (targets as SetTarget[]).filter(
      (target) => target.kind !== "warmup",
    );
    if (
      !required.length ||
      required.some(
        (target) =>
          !(sets as LoggedSet[]).some(
            (set) => set.targetId === target.id && set.outcome === "complete",
          ),
      )
    )
      fail(
        path,
        "completed sessions must contain actual completed records for all prescribed sets",
      );
  }
  const sync = record(
    workout.sync,
    `${path}.sync`,
    ["status"],
    ["error", "syncedAt", "result"],
  );
  choice(sync.status, SYNC_STATUSES, `${path}.sync.status`);
  if (sync.error !== undefined) string(sync.error, `${path}.sync.error`);
  if (sync.syncedAt !== undefined)
    timestamp(sync.syncedAt, `${path}.sync.syncedAt`);
  if (sync.result !== undefined) {
    if (
      !sync.result ||
      typeof sync.result !== "object" ||
      Array.isArray(sync.result)
    )
      fail(`${path}.sync.result`, "must be an object");
    jsonValue(sync.result, `${path}.sync.result`);
  }
}

export function validateAppState(
  value: unknown,
  accountId?: string,
): asserts value is AppState {
  if (accountId !== undefined) validateAccountId(accountId);
  const state = record(value, "state", [
    "schemaVersion",
    "settings",
    "workouts",
    "timerEnd",
    "meet",
    "outbox",
  ]);
  if (state.schemaVersion !== SCHEMA_VERSION)
    fail(
      "state.schemaVersion",
      `unsupported schema version; this app supports ${SCHEMA_VERSION}`,
    );
  const settings = record(state.settings, "state.settings", [
    "trainingMaxes",
    "unit",
    "increment",
    "restSeconds",
    "autoRest",
  ]);
  choice(settings.unit, UNITS, "state.settings.unit");
  number(settings.increment, "state.settings.increment", 0.001, 1000);
  number(settings.restSeconds, "state.settings.restSeconds", 0, 86_400, true);
  bool(settings.autoRest, "state.settings.autoRest");
  const maxes = record(
    settings.trainingMaxes,
    "state.settings.trainingMaxes",
    LIFTS,
  );
  for (const lift of LIFTS) {
    if (maxes[lift] === null) continue;
    const path = `state.settings.trainingMaxes.${lift}`;
    const tm = record(
      maxes[lift],
      path,
      ["weight", "unit", "confirmedAt"],
      ["calibrationRpe"],
    );
    number(tm.weight, `${path}.weight`, 0.001, 100_000);
    choice(tm.unit, UNITS, `${path}.unit`);
    timestamp(tm.confirmedAt, `${path}.confirmedAt`);
    if (tm.calibrationRpe !== undefined)
      number(tm.calibrationRpe, `${path}.calibrationRpe`, 6, 8);
  }
  if (state.timerEnd !== null)
    number(state.timerEnd, "state.timerEnd", 0, 8.64e15, true);
  const workouts = array(state.workouts, "state.workouts");
  workouts.forEach((workout, i) =>
    validateWorkout(workout, `state.workouts[${i}]`, accountId),
  );
  unique(workouts, (item) => String(item.id), "state.workouts");
  const workoutMap = new Map(
    (workouts as Workout[]).map((workout) => [workout.id, workout]),
  );
  const meet = record(state.meet, "state.meet", ["unit", "attempts"]);
  choice(meet.unit, UNITS, "state.meet.unit");
  const attempts = array(meet.attempts, "state.meet.attempts", 9);
  attempts.forEach((value, i) => {
    const path = `state.meet.attempts[${i}]`;
    const attempt = record(value, path, [
      "id",
      "lift",
      "number",
      "weight",
      "unit",
      "outcome",
      "notes",
    ]);
    id(attempt.id, `${path}.id`);
    choice(attempt.lift, LIFTS, `${path}.lift`);
    number(attempt.number, `${path}.number`, 1, 3, true);
    choice(attempt.unit, UNITS, `${path}.unit`);
    choice(
      attempt.outcome,
      ["good", "no-lift", "not-taken"],
      `${path}.outcome`,
    );
    string(attempt.notes, `${path}.notes`);
    if (attempt.weight !== null)
      number(attempt.weight, `${path}.weight`, 0.001, 100_000);
    if (attempt.outcome === "good" && attempt.weight === null)
      fail(path, "a successful attempt requires its actual weight");
  });
  unique(attempts, (item) => String(item.id), "state.meet.attempts");
  unique(
    attempts,
    (item) => `${item.lift}:${item.number}`,
    "state.meet.attempts",
  );
  const outbox = array(state.outbox, "state.outbox");
  outbox.forEach((value, i) => {
    const path = `state.outbox[${i}]`;
    const entry = record(
      value,
      path,
      [
        "id",
        "accountId",
        "workoutId",
        "revision",
        "snapshot",
        "status",
        "createdAt",
        "updatedAt",
        "attempts",
        "nextAttemptAt",
        "lastAttemptAt",
      ],
      ["reason"],
    );
    id(entry.id, `${path}.id`, 1000);
    id(entry.accountId, `${path}.accountId`);
    id(entry.workoutId, `${path}.workoutId`);
    number(
      entry.revision,
      `${path}.revision`,
      0,
      Number.MAX_SAFE_INTEGER,
      true,
    );
    number(
      entry.attempts,
      `${path}.attempts`,
      0,
      Number.MAX_SAFE_INTEGER,
      true,
    );
    choice(
      entry.status,
      ["pending", "synced", "failed", "needs-attention"],
      `${path}.status`,
    );
    if (entry.reason !== undefined) string(entry.reason, `${path}.reason`);
    timestamp(entry.createdAt, `${path}.createdAt`);
    timestamp(entry.updatedAt, `${path}.updatedAt`);
    if (entry.nextAttemptAt !== null)
      timestamp(entry.nextAttemptAt, `${path}.nextAttemptAt`);
    if (entry.lastAttemptAt !== null)
      timestamp(entry.lastAttemptAt, `${path}.lastAttemptAt`);
    const workout = workoutMap.get(entry.workoutId);
    if (
      !workout ||
      entry.accountId !== workout.accountId ||
      (accountId !== undefined && entry.accountId !== accountId)
    )
      fail(path, "outbox must reference a workout in the same account");
    if (entry.revision > workout.revision)
      fail(path, "outbox revision is newer than its workout");
    validateWorkout(entry.snapshot, `${path}.snapshot`, entry.accountId);
    const snapshot = entry.snapshot as Workout;
    if (snapshot.id !== entry.workoutId || snapshot.revision !== entry.revision)
      fail(
        path,
        "outbox snapshot must match its session identity and revision",
      );
    if (entry.status === "needs-attention" && entry.nextAttemptAt !== null)
      fail(path, "blocked operations cannot schedule blind retries");
  });
  unique(outbox, (item) => String(item.id), "state.outbox");
  unique(
    outbox,
    (item) => `${item.accountId}:${item.workoutId}:${item.revision}`,
    "state.outbox",
  );
}

/** Future migration cases must transform a copy, validate it, then save atomically. */
export function migrateAppState(value: unknown, accountId?: string): AppState {
  if (
    value &&
    typeof value === "object" &&
    typeof (value as JsonRecord).schemaVersion === "number" &&
    ((value as JsonRecord).schemaVersion as number) > SCHEMA_VERSION
  ) {
    throw new DataValidationError(
      "This data was saved by a newer tracker version. Update the app to open it. Your stored data has been preserved.",
    );
  }
  validateAppState(value, accountId);
  return structuredClone(value);
}
