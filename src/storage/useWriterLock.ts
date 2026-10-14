import { useCallback, useEffect, useState } from "react";

/** One writer also protects connection changes and transfers between account scopes. */
export const WRITER_LOCK_NAME = "smolov-sbd-writer-v1";
export type WriterLockStatus =
  "acquiring" | "writable" | "read-only" | "unsupported" | "error";

export interface WriterLockState {
  status: WriterLockStatus;
  canWrite: boolean;
  message: string;
  retry: () => void;
}

export interface WriterLease {
  release: () => void;
  /** Resolves after the browser has released ownership, including rejected acquisitions. */
  closed: Promise<void>;
}

type LockManagerPort = Pick<LockManager, "request">;

function browserLocks(): LockManagerPort | undefined {
  try {
    return typeof navigator !== "undefined" ? navigator.locks : undefined;
  } catch {
    return undefined;
  }
}

export function writerLockMessage(status: WriterLockStatus): string {
  if (status === "acquiring")
    return "Checking which tracker tab can save changes…";
  if (status === "read-only")
    return "Another Smolov tab is saving changes. Close that tab, then retry here.";
  if (status === "unsupported")
    return "This browser cannot coordinate tracker tabs safely. Open the tracker in a current browser to log changes.";
  if (status === "error")
    return "This browser could not reserve local editing. Retry or open the tracker in a current browser.";
  return "";
}

/** Never steals ownership; closing the owning tab releases its browser-managed lock. */
export function requestWriterLease(
  onStatus: (status: WriterLockStatus) => void,
  manager = browserLocks(),
): WriterLease {
  let canceled = false;
  let releaseHold!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseHold = resolve;
  });
  const release = () => {
    canceled = true;
    releaseHold();
  };
  onStatus("acquiring");
  if (!manager) {
    onStatus("unsupported");
    return { release, closed: Promise.resolve() };
  }
  const closed = Promise.resolve()
    .then(() =>
      manager.request(
        WRITER_LOCK_NAME,
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (canceled) return;
          if (!lock) {
            onStatus("read-only");
            return;
          }
          onStatus("writable");
          await held;
        },
      ),
    )
    .then(() => undefined)
    .catch(() => {
      if (!canceled) onStatus("error");
    });
  return { release, closed };
}

/** Reload durable state after acquisition before enabling writes from a previously blocked tab. */
export function useWriterLock(): WriterLockState {
  const [attempt, setAttempt] = useState(0);
  const [leaseState, setLeaseState] = useState<{
    attempt: number;
    status: WriterLockStatus;
  }>({ attempt: 0, status: "acquiring" });
  useEffect(() => {
    const lease = requestWriterLease((status) =>
      setLeaseState({ attempt, status }),
    );
    return lease.release;
  }, [attempt]);
  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  const status =
    leaseState.attempt === attempt ? leaseState.status : "acquiring";
  return {
    status,
    canWrite: status === "writable",
    message: writerLockMessage(status),
    retry,
  };
}
