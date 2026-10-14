import type { Workout } from "../domain/types";
import type { AppState, OutboxEntry } from "./types";
import { validateAppState, validateAccountId } from "./validation";

export const UNSUPPORTED_SYNC_REASON =
  "The existing Powerlevels service has not advertised a safe Smolov sync contract. Your workout is saved locally; connection needs attention.";

export interface EnqueueOptions {
  status?: "pending" | "needs-attention";
  reason?: string;
  now?: Date;
}

export interface SyncResult {
  status: "pending" | "synced" | "failed" | "needs-attention";
  reason?: string;
  syncedAt?: string;
  retryable?: boolean;
  ambiguous?: boolean;
}

export function outboxOperationId(
  accountId: string,
  workoutId: string,
  revision: number,
): string {
  return JSON.stringify([accountId, workoutId, revision]);
}

function content(workout: Workout): string {
  const { sync: _sync, ...session } = workout;
  return JSON.stringify(session);
}

/** Queuing is local; only the real adapter can acknowledge a successful upload. */
export function enqueueWorkout(
  state: AppState,
  workout: Workout,
  options: EnqueueOptions = {},
): AppState {
  validateAccountId(workout.accountId);
  validateAppState(state, workout.accountId);
  if (workout.status === "active")
    throw new Error(
      "Finish or stop this workout before adding it to the sync queue.",
    );
  const next = structuredClone(state);
  const current = next.workouts.find((item) => item.id === workout.id);
  if (current && current.revision > workout.revision)
    throw new Error(
      "A newer workout revision is already saved. Queue its latest correction.",
    );
  const operationId = outboxOperationId(
    workout.accountId,
    workout.id,
    workout.revision,
  );
  const queued = next.outbox.find((item) => item.id === operationId);
  if (queued) {
    if (content(queued.snapshot) !== content(workout))
      throw new Error(
        "The same session revision cannot contain different workout data. Save the edit as a new revision.",
      );
    return next;
  }
  const now = (options.now ?? new Date()).toISOString();
  const status = options.status ?? "needs-attention";
  const reason =
    options.reason ??
    (status === "needs-attention" ? UNSUPPORTED_SYNC_REASON : undefined);
  for (const entry of next.outbox) {
    if (
      entry.workoutId === workout.id &&
      entry.revision < workout.revision &&
      ["pending", "failed"].includes(entry.status)
    ) {
      entry.status = "needs-attention";
      entry.reason =
        "This revision was replaced by a later local correction. Review the latest revision before syncing.";
      entry.nextAttemptAt = null;
      entry.updatedAt = now;
    }
  }
  const updated: Workout = {
    ...structuredClone(workout),
    sync: { status, ...(reason ? { error: reason } : {}) },
  };
  const index = next.workouts.findIndex((item) => item.id === workout.id);
  if (index >= 0) next.workouts[index] = updated;
  else next.workouts.push(updated);
  next.outbox.push({
    id: operationId,
    accountId: workout.accountId,
    workoutId: workout.id,
    revision: workout.revision,
    snapshot: structuredClone(workout),
    status,
    ...(reason ? { reason } : {}),
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    nextAttemptAt: null,
    lastAttemptAt: null,
  });
  validateAppState(next, workout.accountId);
  return next;
}

/** Ambiguous, authentication, and unsupported results always pause automatic retries. */
export function updateSync(
  state: AppState,
  workoutId: string,
  revision: number,
  result: SyncResult,
  now = new Date(),
): AppState {
  const next = structuredClone(state);
  const entry = next.outbox.find(
    (item) => item.workoutId === workoutId && item.revision === revision,
  );
  if (!entry)
    throw new Error("This workout revision is not in the durable sync queue.");
  validateAppState(state, entry.accountId);
  const timestamp = now.toISOString();
  const canRetry =
    result.retryable === true &&
    !result.ambiguous &&
    ["pending", "failed"].includes(result.status);
  const status =
    result.ambiguous ||
    (["pending", "failed"].includes(result.status) && !canRetry)
      ? "needs-attention"
      : result.status;
  entry.status = status;
  entry.attempts++;
  entry.updatedAt = timestamp;
  entry.lastAttemptAt = timestamp;
  entry.nextAttemptAt = canRetry
    ? new Date(
        now.getTime() +
          Math.min(300_000, 1000 * 2 ** Math.min(entry.attempts, 8)),
      ).toISOString()
    : null;
  if (result.reason) entry.reason = result.reason;
  else delete entry.reason;
  if (status === "needs-attention" && !entry.reason)
    entry.reason = result.ambiguous
      ? "The service response was ambiguous. Reconcile this saved session before another upload."
      : UNSUPPORTED_SYNC_REASON;
  const current = next.workouts.find((item) => item.id === workoutId);
  if (current?.revision === revision) {
    current.sync = {
      status,
      ...(entry.reason ? { error: entry.reason } : {}),
      ...(status === "synced"
        ? { syncedAt: result.syncedAt ?? timestamp }
        : {}),
    };
  }
  validateAppState(next, entry.accountId);
  return next;
}

/** Only safe, current revisions in the selected account are eligible on reopen. */
export function listEligibleOutbox(
  state: AppState,
  accountId: string,
  now = new Date(),
): OutboxEntry[] {
  validateAccountId(accountId);
  const current = new Map(
    state.workouts.map((workout) => [workout.id, workout.revision]),
  );
  return state.outbox
    .filter(
      (entry) =>
        entry.accountId === accountId &&
        current.get(entry.workoutId) === entry.revision &&
        ["pending", "failed"].includes(entry.status) &&
        (entry.attempts === 0 ||
          (entry.nextAttemptAt !== null &&
            Date.parse(entry.nextAttemptAt) <= now.getTime())),
    )
    .map((entry) => structuredClone(entry));
}
