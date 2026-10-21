import type {
  MeetAttempt,
  Settings,
  Unit,
  WeekReview,
  Workout,
} from "../domain/types";

export const SCHEMA_VERSION = 1 as const;
export const LOCAL_ACCOUNT_ID = "local-unpaired";

/** Every outbox operation belongs to one immutable session revision and account. */
export interface OutboxEntry {
  id: string;
  accountId: string;
  workoutId: string;
  revision: number;
  snapshot: Workout;
  status: "pending" | "synced" | "failed" | "needs-attention";
  reason?: string;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
}

export interface AppState {
  schemaVersion: typeof SCHEMA_VERSION;
  settings: Settings;
  workouts: Workout[];
  timerEnd: number | null;
  meet: { unit: Unit; attempts: MeetAttempt[] };
  outbox: OutboxEntry[];
  /** Absent in original backups; saved reviews follow the account's workouts. */
  weekReviews?: WeekReview[];
}

export function createInitialState(settings: Settings): AppState {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: structuredClone(settings),
    workouts: [],
    timerEnd: null,
    meet: { unit: settings.unit, attempts: [] },
    outbox: [],
  };
}
