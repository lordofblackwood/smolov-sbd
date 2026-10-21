export type Lift = "squat" | "bench" | "deadlift";
export type Unit = "lb" | "kg";
export type WeekFeeling = "easy" | "good" | "decent" | "ok" | "hard";

export interface WeekReview {
  weekId: string;
  feelings: Record<Lift, WeekFeeling>;
  /** Cumulative weekly loading offsets from the base percentages, in pounds. */
  offsetsLb: Record<Lift, number>;
  reviewedAt: string;
}

export type Phase =
  "calibration" | "volume-1" | "volume-2" | "peak" | "taper" | "meet";

export interface TrainingMax {
  weight: number;
  unit: Unit;
  confirmedAt: string;
  calibrationRpe?: number;
}

export interface Settings {
  trainingMaxes: Record<Lift, TrainingMax | null>;
  unit: Unit;
  /** Available loading increment in the display unit. */
  increment: number;
  restSeconds: number;
  autoRest: boolean;
}

export interface Block {
  id: string;
  lift: Lift;
  sets: number;
  reps: number;
  percent?: number;
  offsetLb?: number;
  rpeTarget?: string;
  kind: "working" | "calibration" | "final-single";
}

export interface ProgramDay {
  date: string;
  phase: Phase;
  blocks: readonly Block[];
  recovery: string | null;
  optionalAccessories?: string;
}

export interface SetTarget {
  id: string;
  blockId: string;
  lift: Lift;
  setNumber: number;
  reps: number;
  weight: number | null;
  unit: Unit;
  rule: string;
  rpeTarget?: string;
  kind: "working" | "calibration" | "final-single" | "warmup";
}

export interface LoggedSet {
  id: string;
  targetId: string;
  lift: Lift;
  weight: number;
  unit: Unit;
  /** Actual reps performed; a skipped set always has zero. */
  reps: number;
  outcome: "complete" | "failed" | "skipped";
  rpe?: number;
  notes: string;
  pain: boolean;
  loggedAt: string;
}

export interface SyncState {
  status: "local" | "pending" | "synced" | "failed" | "needs-attention";
  error?: string;
  syncedAt?: string;
  /** Values are added only when returned by the connected service. */
  result?: Record<string, unknown>;
}

export interface Workout {
  id: string;
  revision: number;
  /** Stable position in the undated program; older scheduled records omit it. */
  programSessionId?: string;
  /** Actual workout date for program sessions; original date for saved history. */
  date: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  status: "active" | "completed" | "partial" | "skipped";
  targets: SetTarget[];
  sets: LoggedSet[];
  notes: string;
  sync: SyncState;
  accountId: string;
  source?: string;
}

export interface MeetAttempt {
  id: string;
  lift: Lift;
  number: 1 | 2 | 3;
  weight: number | null;
  unit: Unit;
  outcome: "good" | "no-lift" | "not-taken";
  notes: string;
}
