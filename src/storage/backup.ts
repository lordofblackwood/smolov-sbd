import type { Workout } from "../domain/types";
import type { AppState } from "./types";
import { LOCAL_ACCOUNT_ID } from "./types";
import {
  DataValidationError,
  migrateAppState,
  validateAccountId,
  validateActivityTimestamp,
  validateAppState,
} from "./validation";

export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

export interface ImportReport {
  addedWorkouts: number;
  duplicateWorkouts: number;
  conflictingWorkoutIds: string[];
  addedMeetAttempts: number;
  conflictingMeetSlots: string[];
  addedOutboxEntries: number;
  conflictingOutboxIds: string[];
  settingsImported: boolean;
}

export interface ImportOptions {
  restorePreferences?: boolean;
}

function sameRecord(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value)
        .sort()
        .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
        .map(
          (key) =>
            `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
        )
        .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
  };
  return canonical(left) === canonical(right);
}

export function exportBackup(
  state: AppState,
  accountId = LOCAL_ACCOUNT_ID,
  now = new Date(),
): string {
  validateAccountId(accountId);
  validateAppState(state, accountId);
  const text = JSON.stringify(
    {
      format: "smolov-sbd-backup",
      backupVersion: 1,
      accountId,
      exportedAt: now.toISOString(),
      state,
    },
    null,
    2,
  );
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES)
    throw new DataValidationError("Backup exceeds the 5 MB safety limit.");
  return text;
}

/** Validate first, merge into a copy, and let the caller explicitly save the result. */
export function importBackup(
  text: string,
  current: AppState,
  accountId = LOCAL_ACCOUNT_ID,
  options: ImportOptions = {},
): { state: AppState; report: ImportReport } {
  validateAccountId(accountId);
  validateAppState(current, accountId);
  if (
    typeof text !== "string" ||
    new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES
  )
    throw new DataValidationError(
      "Backup must be a JSON file no larger than 5 MB.",
    );
  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new DataValidationError("This file does not contain valid JSON.");
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope))
    throw new DataValidationError("Backup must contain an object.");
  const backup = envelope as Record<string, unknown>;
  const fields = [
    "format",
    "backupVersion",
    "accountId",
    "exportedAt",
    "state",
  ];
  if (
    Object.keys(backup).some((key) => !fields.includes(key)) ||
    fields.some((key) => !Object.hasOwn(backup, key))
  )
    throw new DataValidationError(
      "Backup header has missing or unsupported fields.",
    );
  if (backup.format !== "smolov-sbd-backup" || backup.backupVersion !== 1)
    throw new DataValidationError("Unsupported backup format/version.");
  validateAccountId(backup.accountId);
  if (backup.accountId !== accountId)
    throw new DataValidationError(
      "This backup belongs to a different account. Open its account before importing; records have not been changed.",
    );
  validateActivityTimestamp(backup.exportedAt, "backup.exportedAt");
  const incoming = migrateAppState(backup.state, accountId);
  const merged = structuredClone(current);
  const report: ImportReport = {
    addedWorkouts: 0,
    duplicateWorkouts: 0,
    conflictingWorkoutIds: [],
    addedMeetAttempts: 0,
    conflictingMeetSlots: [],
    addedOutboxEntries: 0,
    conflictingOutboxIds: [],
    settingsImported: false,
  };
  const existing = new Map(
    merged.workouts.map((workout) => [workout.id, workout]),
  );
  const importedIds = new Set<string>();
  for (const workout of incoming.workouts) {
    const local = existing.get(workout.id);
    if (local) {
      if (sameRecord(local, workout)) report.duplicateWorkouts++;
      else report.conflictingWorkoutIds.push(workout.id);
      continue;
    }
    merged.workouts.push(workout);
    existing.set(workout.id, workout);
    importedIds.add(workout.id);
    report.addedWorkouts++;
  }
  for (const attempt of incoming.meet.attempts) {
    const slot = `${attempt.lift}:${attempt.number}`;
    const local = merged.meet.attempts.find(
      (item) =>
        item.id === attempt.id || `${item.lift}:${item.number}` === slot,
    );
    if (local) {
      if (!sameRecord(local, attempt)) report.conflictingMeetSlots.push(slot);
      continue;
    }
    merged.meet.attempts.push(attempt);
    report.addedMeetAttempts++;
  }
  for (const entry of incoming.outbox) {
    const local = merged.outbox.find(
      (item) =>
        item.id === entry.id ||
        (item.workoutId === entry.workoutId &&
          item.revision === entry.revision &&
          item.accountId === entry.accountId),
    );
    if (local) {
      if (!sameRecord(local, entry)) report.conflictingOutboxIds.push(entry.id);
      continue;
    }
    // An imported operation never replaces or modifies an existing local session.
    if (!importedIds.has(entry.workoutId)) continue;
    merged.outbox.push(entry);
    report.addedOutboxEntries++;
  }
  if (options.restorePreferences) {
    merged.settings = incoming.settings;
    merged.timerEnd = incoming.timerEnd;
    merged.meet.unit = incoming.meet.unit;
    report.settingsImported = true;
  }
  validateAppState(merged, accountId);
  return { state: merged, report };
}

export function backupFilename(now = new Date()): string {
  return `smolov-sbd-backup-${now.toISOString().slice(0, 10)}.json`;
}

/** A convenience guard for UI reports; imported records never overwrite these. */
export function hasLocalHistory(workouts: readonly Workout[]): boolean {
  return workouts.length > 0;
}
