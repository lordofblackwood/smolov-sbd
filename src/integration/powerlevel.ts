import {
  LIFTS,
  SOURCE_KEYS,
  dateValid,
  validateSnapshot,
} from "./vendor/history.mjs";
import {
  SYNC_ENDPOINT,
  authFor,
  cleanCode,
  decryptSnapshot,
  encryptSnapshot,
} from "./vendor/sync.mjs";
import type { Workout } from "../domain/types";

/** Reused identifiers; the service has no deadlift-variant catalog. */
export const EXERCISE_IDS = {
  squat: "backSquat",
  bench: "benchPress",
  deadlift: "deadlift",
} as const;
export const POWERLEVEL_ENDPOINT = SYNC_ENDPOINT;
/** Supported schema names; runtime discovery still gates every Smolov upload. */
export const KNOWN_POWERLEVEL_SOURCES = Object.freeze(
  Object.keys(SOURCE_KEYS),
);
export const SOURCE_LIMITATION =
  "Powerlevels needs a separate Smolov source. Uploads are paused to protect Auto Bulgarian history.";

export type WeightUnit = "lb" | "kg";
export type LiftKey = keyof typeof EXERCISE_IDS;
export type SyncStatus = "pending" | "synced" | "failed" | "needs-attention";
export interface Connection {
  code: string;
  accountId: string;
}

/** Local account scope is deliberately distinct from the relay bearer credential. */
export async function pairConnection(input: string): Promise<Connection> {
  const code = cleanCode(input);
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`smolov-local-account:${code}`),
  );
  const accountId = [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return { code, accountId };
}

export function convertWeight(
  weight: number,
  from: WeightUnit,
  to: WeightUnit,
): number {
  if (!Number.isFinite(weight) || weight < 0)
    throw new Error("Weight must be a non-negative finite number.");
  if (!["lb", "kg"].includes(from) || !["lb", "kg"].includes(to))
    throw new Error("Unsupported weight unit.");
  if (from === to) return weight;
  return from === "lb" ? weight * 0.45359237 : weight / 0.45359237;
}

export interface ActualSetInput {
  id: string;
  lift: LiftKey;
  actualWeight: number | null;
  actualReps: number | null;
  unit: WeightUnit;
  outcome: "completed" | "failed" | "skipped";
  actualTimestamp?: string;
  rpe?: number | null;
  notes?: string;
  warmup?: boolean;
}

export interface ExistingEventFields {
  id: string;
  date: string;
  exercise: string;
  name: string;
  success: boolean;
  singleCompleted: boolean;
  weight: number;
  unit: "lb";
  sets: 1;
  reps: number;
  outcome: ActualSetInput["outcome"];
  countsDay: boolean;
}

/**
 * Field preview only: it intentionally has no source and cannot be submitted.
 * No repSet is fabricated: the current dashboard ties that field to a proven
 * single, so an ordinary volume set does not have matching semantics.
 */
export function mapActualSetFields(
  sessionId: string,
  actualDate: string,
  set: ActualSetInput,
): ExistingEventFields | null {
  if (!sessionId || !set.id || !dateValid(actualDate))
    throw new Error("The actual set identity or date is invalid.");
  if (!(set.lift in EXERCISE_IDS))
    throw new Error("No existing exercise mapping is available.");
  if (!["completed", "failed", "skipped"].includes(set.outcome))
    throw new Error("The set outcome is invalid.");
  if (set.outcome === "skipped") return null;
  if (set.actualWeight === null || set.actualReps === null) return null;
  if (!Number.isInteger(set.actualReps) || set.actualReps < 0)
    throw new Error("Actual reps must be a non-negative whole number.");
  const exercise = EXERCISE_IDS[set.lift];
  return {
    id: `${encodeURIComponent(sessionId)}:${encodeURIComponent(set.id)}`,
    date: actualDate,
    exercise,
    name: LIFTS[exercise],
    success: set.outcome === "completed" && set.actualReps > 0,
    singleCompleted:
      set.outcome === "completed" && set.actualReps === 1 && !set.warmup,
    weight: convertWeight(set.actualWeight, set.unit, "lb"),
    unit: "lb",
    sets: 1,
    reps: set.actualReps,
    outcome: set.outcome,
    countsDay: set.actualReps > 0 || set.outcome === "failed",
  };
}

export interface ConnectionCheck {
  status: "available" | "auth-error" | "unreachable" | "failed";
  message: string;
  uploadsSupported: boolean;
}

/** Explicit user action only; checks the existing read endpoint, never uploads. */
export async function checkConnection(
  input: string,
  options: { fetcher?: typeof fetch; signal?: AbortSignal } = {},
): Promise<ConnectionCheck> {
  const code = cleanCode(input);
  const signal = options.signal ?? AbortSignal.timeout(15000);
  try {
    const supported = await discoverContract({ ...options, signal });
    const response = await (options.fetcher ?? fetch)(
      `${SYNC_ENDPOINT}/api/history/${supported ? "smolov" : "bulgarian"}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${await authFor(code)}` },
        cache: "no-store",
        signal,
      },
    );
    if (response.body) await response.body.cancel().catch(() => undefined);
    if ([401, 403].includes(response.status))
      return {
        status: "auth-error",
        message:
          "The relay rejected this connection or browser origin. Uploads remain paused.",
        uploadsSupported: false,
      };
    if ((response.ok || response.status === 404) && supported)
      return {
        status: "available",
        message:
          "The existing relay supports independent Smolov uploads. No workout was uploaded by this check.",
        uploadsSupported: true,
      };
    if (response.ok || response.status === 404)
      return {
        status: "available",
        message:
          response.status === 404
            ? "The relay is reachable. No Auto Bulgarian snapshot exists for this code. Smolov uploads still need a supported source."
            : "The existing relay is reachable. Smolov uploads still need a supported source.",
        uploadsSupported: false,
      };
    return {
      status: "failed",
      message: `The relay returned ${response.status}. Your local workouts are saved; uploads remain paused.`,
      uploadsSupported: false,
    };
  } catch {
    return {
      status: "unreachable",
      message:
        "The relay could not be reached from this browser. Your local workouts are saved; uploads remain paused.",
      uploadsSupported: false,
    };
  }
}

export interface SmolovSession {
  id: string;
  revision: number;
  trainingDate: string;
  scheduledDate: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  status: "completed" | "partial" | "skipped";
  notes: string;
}
export interface SmolovEvent {
  id: string;
  source: "smolov";
  sessionId: string;
  setId: string;
  revision: number;
  date: string;
  occurredAt: string;
  exercise: string;
  name: string;
  weight: number | null;
  unit: "lb";
  originalWeight: number | null;
  originalUnit: WeightUnit;
  sets: 1;
  reps: number;
  outcome: "completed" | "failed" | "skipped";
  success: boolean;
  singleCompleted: boolean;
  countsDay: boolean;
  kind: "working" | "calibration" | "final-single" | "warmup" | "meet-attempt";
  notes: string;
  pain: boolean;
  rpe?: number;
}
export interface SmolovSnapshot {
  schema: 1;
  source: "smolov";
  contract: "smolov-v1";
  sessions: SmolovSession[];
  events: SmolovEvent[];
}
export interface WorkoutSyncResult {
  status: SyncStatus;
  reason?: string;
  syncedAt?: string;
  retryable?: boolean;
  ambiguous?: boolean;
}
export interface SyncOptions {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}

function emptySmolovSnapshot(): SmolovSnapshot {
  return {
    schema: 1,
    source: "smolov",
    contract: "smolov-v1",
    sessions: [],
    events: [],
  };
}

function activityDate(timestamp: string): string {
  if (
    !/(Z|[+-]\d{2}:\d{2})$/.test(timestamp) ||
    !Number.isFinite(Date.parse(timestamp))
  )
    throw new Error("Actual activity needs a timezone-aware timestamp.");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const component = (type: string) =>
    parts.find((part) => part.type === type)!.value;
  return `${component("year")}-${component("month")}-${component("day")}`;
}

/** Exact queued revision only; planned targets never become performed evidence. */
export function snapshotForWorkout(workout: Workout): SmolovSnapshot {
  if (workout.status === "active")
    throw new Error("Finish or stop the workout before syncing.");
  const session: SmolovSession = {
    id: workout.id,
    revision: workout.revision,
    trainingDate: activityDate(workout.startedAt),
    scheduledDate: workout.date,
    startedAt: workout.startedAt,
    updatedAt: workout.updatedAt,
    ...(workout.finishedAt ? { finishedAt: workout.finishedAt } : {}),
    status: workout.status,
    notes: workout.notes,
  };
  const events: SmolovEvent[] = workout.sets
    .map((set): SmolovEvent => {
      const target = workout.targets.find(
        (target) => target.id === set.targetId,
      );
      if (!target || target.lift !== set.lift)
        throw new Error("A logged set has no matching target identity.");
      const skipped = set.outcome === "skipped";
      const outcome = set.outcome === "complete" ? "completed" : set.outcome;
      const success = outcome === "completed" && set.reps > 0;
      const exercise = EXERCISE_IDS[set.lift];
      return {
        id: `${encodeURIComponent(workout.id)}:${encodeURIComponent(set.targetId)}`,
        source: "smolov",
        sessionId: workout.id,
        setId: set.targetId,
        revision: workout.revision,
        date: activityDate(set.loggedAt),
        occurredAt: set.loggedAt,
        exercise,
        name: LIFTS[exercise],
        weight: skipped ? null : convertWeight(set.weight, set.unit, "lb"),
        unit: "lb",
        originalWeight: skipped ? null : set.weight,
        originalUnit: set.unit,
        sets: 1,
        reps: skipped ? 0 : set.reps,
        outcome,
        success,
        singleCompleted: success && set.reps === 1 && target.kind !== "warmup",
        countsDay: !skipped && (set.reps > 0 || outcome === "failed"),
        kind: target.kind,
        notes: set.notes,
        pain: set.pain,
        ...(!skipped &&
        set.rpe !== undefined &&
        ["calibration", "final-single"].includes(target.kind)
          ? { rpe: set.rpe }
          : {}),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const snapshot: SmolovSnapshot = {
    schema: 1,
    source: "smolov",
    contract: "smolov-v1",
    sessions: [session],
    events,
  };
  validateSnapshot(snapshot, "smolov");
  return snapshot;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}

function sessionEvidence(snapshot: SmolovSnapshot, id: string): unknown {
  return {
    session: snapshot.sessions.find((session) => session.id === id) ?? null,
    events: snapshot.events
      .filter((event) => event.sessionId === id)
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** Merge whole sessions, never sets from different revisions of the same session. */
export function mergeSessionRevision(
  remote: SmolovSnapshot,
  local: SmolovSnapshot,
): SmolovSnapshot {
  validateSnapshot(remote, "smolov");
  validateSnapshot(local, "smolov");
  const session = local.sessions[0];
  if (local.sessions.length !== 1 || !session)
    throw new Error("Expected one queued workout revision.");
  const previous = remote.sessions.find((item) => item.id === session.id);
  if (previous && previous.revision > session.revision)
    throw new Error(
      "Powerlevels holds a newer revision of this workout. Reconcile before uploading.",
    );
  if (
    previous?.revision === session.revision &&
    canonical(sessionEvidence(remote, session.id)) !==
      canonical(sessionEvidence(local, session.id))
  )
    throw new Error(
      "This workout revision has different remote content. Reconcile before uploading.",
    );
  return {
    schema: 1,
    source: "smolov",
    contract: "smolov-v1",
    sessions: [
      ...remote.sessions.filter((item) => item.id !== session.id),
      session,
    ].sort((a, b) => a.id.localeCompare(b.id)),
    events: [
      ...remote.events.filter((item) => item.sessionId !== session.id),
      ...local.events,
    ].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

class RelayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

async function discoverContract(options: SyncOptions): Promise<boolean> {
  const response = await (options.fetcher ?? fetch)(`${SYNC_ENDPOINT}/`, {
    method: "GET",
    cache: "no-store",
    signal: options.signal ?? AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new RelayError("The relay capability check failed.", response.status);
  const capability = await response.json();
  const contract = capability?.contracts?.smolov;
  return (
    capability?.service === "Powerlevel encrypted history relay" &&
    Array.isArray(capability.sources) &&
    capability.sources.includes("smolov") &&
    contract?.contract === "smolov-v1" &&
    contract.snapshotSchema === 1 &&
    contract.conditionalWrites === true &&
    contract.corrections === "session-revision-upsert" &&
    ["backSquat", "benchPress", "deadlift"].every((id) =>
      contract.exerciseIds?.includes(id),
    )
  );
}

async function readSmolov(
  code: string,
  options: SyncOptions,
): Promise<{
  snapshot: SmolovSnapshot;
  etag: string | null;
  updatedAt: string | null;
}> {
  const response = await (options.fetcher ?? fetch)(
    `${SYNC_ENDPOINT}/api/history/smolov`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${await authFor(code)}` },
      cache: "no-store",
      signal: options.signal ?? AbortSignal.timeout(15000),
    },
  );
  if (response.status === 404)
    return { snapshot: emptySmolovSnapshot(), etag: null, updatedAt: null };
  if (!response.ok)
    throw new RelayError(
      "The Smolov history could not be read.",
      response.status,
    );
  const envelope = await response.json();
  const snapshot = (await decryptSnapshot(code, envelope, "smolov")) as SmolovSnapshot;
  // Hosting proxies can remove or weaken HTTP ETags. The relay also returns
  // the same object's exact R2 version beside its ciphertext for safe If-Match.
  const etag = envelope.snapshotEtag !== undefined
    ? envelope.snapshotEtag
    : response.headers.get("ETag");
  if (typeof etag !== "string" || !/^"[\x21\x23-\x5b\x5d-\x7e\x80-\xff]+"$/.test(etag))
    throw new RelayError("The relay did not return a safe snapshot ETag.", 428);
  return { snapshot, etag, updatedAt: response.headers.get("X-Synced-At") };
}

function paused(reason: string, ambiguous = false): WorkoutSyncResult {
  return {
    status: "needs-attention",
    reason,
    retryable: false,
    ...(ambiguous ? { ambiguous: true } : {}),
  };
}

function readFailure(error: unknown): WorkoutSyncResult {
  if (error instanceof RelayError && [401, 403].includes(error.status ?? 0))
    return paused(
      "The relay rejected the connection or browser origin. Check the saved code and origin configuration.",
    );
  if (
    error instanceof RelayError &&
    [408, 429, 500, 502, 503, 504].includes(error.status ?? 0)
  )
    return {
      status: "pending",
      reason:
        "The relay is temporarily unavailable. Your saved workout can retry when the app is online.",
      retryable: true,
    };
  if (
    error instanceof TypeError ||
    (error instanceof Error &&
      ["AbortError", "TimeoutError"].includes(error.name))
  )
    return {
      status: "pending",
      reason:
        "The relay could not be reached. Your workout is saved locally for retry.",
      retryable: true,
    };
  return paused(
    error instanceof Error
      ? error.message
      : "The saved workout needs review before it can sync.",
  );
}

/**
 * Prepares no writes against the currently deployed service. Once the exact
 * prepared contract is advertised, uses only its independent source and R2
 * preconditions. An ambiguous write is reconciled by reading exact evidence.
 */
export async function syncWorkout(
  workout: Workout,
  input: string,
  currentAccountId: string,
  options: SyncOptions = {},
): Promise<WorkoutSyncResult> {
  let code: string;
  let local: SmolovSnapshot;
  try {
    const connection = await pairConnection(input);
    code = connection.code;
    if (
      connection.accountId !== currentAccountId ||
      workout.accountId !== currentAccountId
    )
      return paused(
        "This workout belongs to a different Powerlevels connection. Switch back to that connection.",
      );
    local = snapshotForWorkout(workout);
    if (!(await discoverContract(options))) return paused(SOURCE_LIMITATION);
  } catch (error) {
    return readFailure(error);
  }
  let remote: Awaited<ReturnType<typeof readSmolov>>;
  let merged: SmolovSnapshot;
  try {
    remote = await readSmolov(code, options);
    merged = mergeSessionRevision(remote.snapshot, local);
    if (
      canonical(sessionEvidence(remote.snapshot, workout.id)) ===
      canonical(sessionEvidence(local, workout.id))
    )
      return {
        status: "synced",
        syncedAt: remote.updatedAt ?? new Date().toISOString(),
        retryable: false,
      };
  } catch (error) {
    return readFailure(error);
  }
  let envelope: unknown;
  let authorization: string;
  try {
    envelope = await encryptSnapshot(code, merged);
    authorization = `Bearer ${await authFor(code)}`;
  } catch (error) {
    return readFailure(error);
  }
  try {
    const response = await (options.fetcher ?? fetch)(
      `${SYNC_ENDPOINT}/api/history/smolov`,
      {
        method: "PUT",
        cache: "no-store",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
          ...(remote.etag
            ? { "If-Match": remote.etag }
            : { "If-None-Match": "*" }),
        },
        body: JSON.stringify(envelope),
        signal: options.signal ?? AbortSignal.timeout(15000),
      },
    );
    if ([401, 403].includes(response.status))
      return paused(
        "The relay rejected this connection or browser origin. Uploads are paused.",
      );
    if ([412, 428].includes(response.status))
      return paused(
        "Powerlevels history changed or rejected the write precondition. Read and reconcile before retrying.",
      );
    if (response.status === 413)
      return paused(
        "The encrypted history exceeds the relay size limit. Export a backup before resolving it.",
      );
    if (!response.ok && response.status < 500)
      return paused(
        `The relay rejected this upload (${response.status}). Review the contract before retrying.`,
      );
    if (response.ok) {
      const result = await response.json();
      if (
        result?.ok === true &&
        typeof result.updatedAt === "string" &&
        Number.isFinite(Date.parse(result.updatedAt))
      )
        return {
          status: "synced",
          syncedAt: result.updatedAt,
          retryable: false,
        };
    }
  } catch {
    /* A sent write may have committed; reconcile rather than blindly retry. */
  }
  try {
    if (options.signal?.aborted)
      return paused(
        "The upload was interrupted after dispatch. Reconcile this revision before retrying.",
        true,
      );
    const confirmed = await readSmolov(code, options);
    if (
      canonical(sessionEvidence(confirmed.snapshot, workout.id)) ===
      canonical(sessionEvidence(local, workout.id))
    )
      return {
        status: "synced",
        syncedAt: confirmed.updatedAt ?? new Date().toISOString(),
        retryable: false,
      };
  } catch {
    /* Durable outbox keeps the revision paused for explicit review. */
  }
  return paused(
    "The upload response was ambiguous and this exact revision could not be confirmed. Reconcile before another upload.",
    true,
  );
}
