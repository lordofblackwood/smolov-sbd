import type { AppState } from "./types";
import { LOCAL_ACCOUNT_ID } from "./types";
import {
  migrateAppState,
  validateAccountId,
  validateAppState,
} from "./validation";

export const DATABASE_NAME = "smolov-sbd-local";
export const DATABASE_VERSION = 1;
const STORE_NAME = "account-state";
const saveQueues = new Map<string, Promise<void>>();

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(
        new Error(
          "Durable storage is unavailable in this browser. Your changes have not been saved.",
        ),
      );
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let rejected = false;
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME))
        database.createObjectStore(STORE_NAME);
    };
    request.onblocked = () => {
      rejected = true;
      reject(
        new Error(
          "Local storage is open in another app version. Close other tracker tabs and retry.",
        ),
      );
    };
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open local storage."));
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      if (rejected) database.close();
      else resolve(database);
    };
  });
}

async function writeSnapshot(
  snapshot: AppState,
  accountId: string,
): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      let transaction: IDBTransaction;
      try {
        transaction = database.transaction(STORE_NAME, "readwrite", {
          durability: "strict",
        });
      } catch {
        transaction = database.transaction(STORE_NAME, "readwrite");
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Local save failed."));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Local save was interrupted."));
      transaction.objectStore(STORE_NAME).put(snapshot, accountId);
    });
  } finally {
    database.close();
  }
}

/** Captures now, writes in action order, and resolves only after the transaction commits. */
export function saveAppState(
  state: AppState,
  accountId = LOCAL_ACCOUNT_ID,
): Promise<void> {
  try {
    validateAccountId(accountId);
    validateAppState(state, accountId);
    const snapshot = structuredClone(state);
    const previous = saveQueues.get(accountId) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(() => writeSnapshot(snapshot, accountId));
    saveQueues.set(accountId, operation);
    void operation
      .finally(() => {
        if (saveQueues.get(accountId) === operation)
          saveQueues.delete(accountId);
      })
      .catch(() => undefined);
    return operation;
  } catch (error) {
    return Promise.reject(error);
  }
}

/** Corrupt or newer data remains untouched so it can be recovered or opened by its own version. */
export async function loadAppState(
  accountId = LOCAL_ACCOUNT_ID,
): Promise<AppState | null> {
  validateAccountId(accountId);
  await saveQueues.get(accountId)?.catch(() => undefined);
  const database = await openDatabase();
  try {
    const stored = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(accountId);
      let result: unknown;
      request.onsuccess = () => {
        result = request.result;
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () =>
        reject(
          transaction.error ?? new Error("Could not read local workouts."),
        );
      transaction.onabort = () =>
        reject(
          transaction.error ??
            new Error("Reading local workouts was interrupted."),
        );
    });
    if (stored === undefined) return null;
    return migrateAppState(stored, accountId);
  } finally {
    database.close();
  }
}
