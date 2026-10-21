import { useCallback, useEffect, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  DEFAULT_SETTINGS,
  confirmCalibrationTrainingMax,
  finishWorkout,
  formatDate,
  todayDate,
} from "./domain/program";
import { nextTrainingStep, trainingSessions, workoutForSession, startSession, skipSession, programSessionIdForWorkout, type TrainingSession } from "./domain/sequence";
import type { Lift, TrainingMax, WeekReview, Workout as WorkoutType } from "./domain/types";
import {
  createInitialState,
  LOCAL_ACCOUNT_ID,
  loadAppState,
  saveAppState,
  validateAppState,
  enqueueWorkout,
  updateSync,
  listEligibleOutbox,
  type AppState,
} from "./storage";
import {
  checkConnection,
  pairConnection,
  syncWorkout,
  type Connection,
} from "./integration/powerlevel";
import { useWriterLock } from "./storage/useWriterLock";
import { Icon } from "./components/Icon";
import { Modal } from "./components/Modal";
import { WeekCheckIn } from "./components/WeekCheckIn";
import { Today } from "./screens/Today";
import { Program } from "./screens/Program";
import { History } from "./screens/History";
import { Settings, TmReview } from "./screens/Settings";
import { Workout } from "./screens/Workout";
type Page = "today" | "program" | "history" | "settings";
const CONNECTION_KEY = "smolov-sbd-connection-v1";
function savedConnection(): Connection | null {
  try {
    const stored = JSON.parse(localStorage.getItem(CONNECTION_KEY) ?? "null");
    return stored &&
      typeof stored.code === "string" &&
      /^[a-f0-9]{64}$/.test(stored.accountId)
      ? stored
      : null;
  } catch {
    return null;
  }
}
export default function App() {
  const writer = useWriterLock();
  const [loadedWriterStatus, setLoadedWriterStatus] = useState("");
  const canWrite = writer.canWrite && loadedWriterStatus === "writable";
  const canWriteRef = useRef(false);
  canWriteRef.current = canWrite;
  const [connection, setConnection] = useState<Connection | null>(
    savedConnection,
  );
  const [state, setState] = useState<AppState | null>(null);
  const stateRef = useRef<AppState | null>(null);
  const accountRef = useRef(connection?.accountId ?? LOCAL_ACCOUNT_ID);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveStatus, setSaveStatus] = useState("Opening local storage…");
  const [page, setPage] = useState<Page>("today");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [workoutId, setWorkoutId] = useState<string | null>(null);
  const [tmReview, setTmReview] = useState<{
    lift: Lift;
    initial?: TrainingMax;
  } | null>(null);
  const [skipConfirm, setSkipConfirm] = useState(false);
  const [notice, setNotice] = useState("");
  const [connectionStatus, setConnectionStatus] = useState(
    connection
      ? "Paired locally. Upload capability has not been verified."
      : "Not connected. Workouts are saved on this device.",
  );
  const [syncStatus, setSyncStatus] = useState("");
  const [uploadReady, setUploadReady] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const savingVersion = useRef(0);
  const syncing = useRef(false);
  const [installPrompt, setInstallPrompt] = useState<
    (Event & { prompt: () => Promise<void> }) | null
  >(null);
  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW();
  const accountId = connection?.accountId ?? LOCAL_ACCOUNT_ID;
  useEffect(() => {
    let canceled = false;
    stateRef.current = null;
    setState(null);
    setLoadedWriterStatus("");
    setLoadError("");
    accountRef.current = accountId;
    void (async () => {
      try {
        if (connection) {
          const checked = await pairConnection(connection.code);
          if (checked.accountId !== accountId)
            throw Error(
              "Saved connection identity does not match. Restore the correct connection before opening its data.",
            );
        }
        const saved = await loadAppState(accountId);
        if (canceled) return;
        const initial = saved ?? createInitialState(DEFAULT_SETTINGS);
        stateRef.current = initial;
        setState(initial);
        setLoadedWriterStatus(writer.status);
        setSaveStatus(saved ? "Saved locally" : "Local storage ready");
        setSaveError("");
      } catch (e) {
        if (!canceled) setLoadError((e as Error).message);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [accountId, connection, writer.status]);
  const commit = useCallback((next: AppState): Promise<void> => {
    if (!canWriteRef.current)
      throw Error(
        "This tracker is read-only until it owns the editing lock. Close the other tracker tab and retry.",
      );
    const scope = accountRef.current;
    validateAppState(next, scope);
    stateRef.current = next;
    setState(next);
    setSaveStatus("Saving locally…");
    const version = ++savingVersion.current;
    return saveAppState(next, scope)
      .then(() => {
        if (accountRef.current === scope && version === savingVersion.current) {
          setSaveStatus("Saved locally");
          setSaveError("");
        }
      })
      .catch((e) => {
        if (accountRef.current === scope) {
          setSaveStatus("Local save failed");
          setSaveError((e as Error).message);
        }
        throw e;
      });
  }, []);
  const mutate = useCallback(
    (change: (current: AppState) => AppState) => {
      const current = stateRef.current;
      if (!current) throw Error("Local storage is not ready.");
      const next = change(current);
      const saved = commit(next);
      void saved.catch(() => undefined);
      return saved;
    },
    [commit],
  );
  const retrySync = useCallback(
    async (manual = false) => {
      if (syncing.current || !stateRef.current || !canWriteRef.current) return;
      const conn = connection;
      const scope = accountRef.current;
      if (!conn) {
        if (manual)
          setSyncStatus(
            "Pair your existing Powerlevel account before uploading. Saved workouts remain local.",
          );
        return;
      }
      if (!navigator.onLine) {
        if (manual)
          setSyncStatus(
            "Offline. Logging stays local; pending uploads retry when the app reconnects.",
          );
        return;
      }
      syncing.current = true;
      try {
        const current = stateRef.current;
        const latest = new Map(current.workouts.map((w) => [w.id, w.revision]));
        const entries = manual
          ? current.outbox.filter(
              (e) =>
                e.accountId === scope &&
                latest.get(e.workoutId) === e.revision,
            )
          : listEligibleOutbox(current, scope);
        if (!entries.length) {
          if (manual) setSyncStatus("No finished workouts to sync.");
          return;
        }
        setSyncStatus(
          manual
            ? "Checking saved workouts against Powerlevel…"
            : "Syncing saved workouts to Powerlevel…",
        );
        let confirmed = 0;
        let problem: string | undefined;
        for (const entry of entries) {
          if (accountRef.current !== scope) break;
          const latestRecord = stateRef.current?.workouts.find(
            (w) => w.id === entry.workoutId,
          );
          if (
            !latestRecord ||
            latestRecord.revision !== entry.revision ||
            latestRecord.status === "active"
          )
            continue;
          const result = await syncWorkout(entry.snapshot, conn.code, scope);
          if (accountRef.current !== scope || !stateRef.current) break;
          await commit(
            updateSync(
              stateRef.current,
              entry.workoutId,
              entry.revision,
              result,
            ),
          );
          if (result.status === "synced") {
            confirmed++;
            setUploadReady(true);
          } else {
            problem ??= result.reason ?? result.status;
          }
          setSyncStatus(
            problem ??
              `${confirmed} saved workout${confirmed === 1 ? "" : "s"} confirmed in Powerlevel. Refresh Powerlevel History → All training or Smolov SBD to view.`,
          );
          if (result.status === "needs-attention") break;
        }
      } catch (e) {
        if (accountRef.current === scope)
          setSyncStatus((e as Error).message);
      } finally {
        syncing.current = false;
      }
    },
    [connection, commit],
  );
  useEffect(() => {
    const on = () => {
      setOnline(true);
      void retrySync();
    };
    const off = () => setOnline(false);
    const install = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as Event & { prompt: () => Promise<void> });
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener("beforeinstallprompt", install);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("beforeinstallprompt", install);
    };
  }, [retrySync]);
  useEffect(() => {
    if (!state || !connection || !canWrite) return;
    let canceled = false;
    if (navigator.onLine)
      void checkConnection(connection.code).then((result) => {
        if (!canceled) {
          setUploadReady(result.uploadsSupported);
          setConnectionStatus(result.message);
        }
      });
    void retrySync();
    return () => {
      canceled = true;
    };
  }, [Boolean(state), connection, retrySync, canWrite]);
  useEffect(() => {
    if (!state || !connection) return;
    const id = setInterval(() => void retrySync(), 15000);
    return () => clearInterval(id);
  }, [Boolean(state), connection, retrySync]);
  const navigate = (next: Page) => {
    setPage(next);
    setWorkoutId(null);
    setNotice("");
    if (next === "today") setSelectedSessionId(null);
    window.scrollTo(0, 0);
  };
  const pair = async (code: string, adopt: boolean) => {
    if (!canWriteRef.current)
      throw Error("Close the other tracker tab before changing connections.");
    if (stateRef.current?.workouts.some((w) => w.status === "active"))
      throw Error(
        "Finish or stop your active workout before changing accounts.",
      );
    const nextConnection = await pairConnection(code);
    const local = stateRef.current;
    if (local) await saveAppState(local, accountRef.current);
    let next =
      (await loadAppState(nextConnection.accountId)) ??
      createInitialState(local?.settings ?? DEFAULT_SETTINGS);
    let adoptionConflicts = 0;
    if (adopt && local && accountRef.current === LOCAL_ACCOUNT_ID) {
      const existing = new Set(next.workouts.map((w) => w.id));
      for (const record of local.workouts) {
        if (existing.has(record.id) || record.sync.status === "synced")
          continue;
        const sessionId = programSessionIdForWorkout(record, local.workouts);
        if (sessionId && next.workouts.some(saved =>
          (saved.programSessionId || record.programSessionId) && programSessionIdForWorkout(saved, next.workouts) === sessionId)) {
          adoptionConflicts++;
          continue;
        }
        const moved = {
          ...structuredClone(record),
          accountId: nextConnection.accountId,
          sync: { status: "local" as const },
        };
        next = { ...next, workouts: [...next.workouts, moved] };
        if (moved.status !== "active")
          next = enqueueWorkout(next, moved, { status: "pending" });
      }
    }
    if (adopt && local && accountRef.current === LOCAL_ACCOUNT_ID) {
      const existingReviews = new Set(next.weekReviews?.map(review => review.weekId));
      const adoptedReviews = (local.weekReviews ?? []).filter(review => !existingReviews.has(review.weekId));
      if (adoptedReviews.length) next = { ...next, weekReviews: [...(next.weekReviews ?? []), ...structuredClone(adoptedReviews)] };
    }
    await saveAppState(next, nextConnection.accountId);
    localStorage.setItem(CONNECTION_KEY, JSON.stringify(nextConnection));
    if (adoptionConflicts) setNotice(`${adoptionConflicts} overlapping workouts remain in unpaired storage. Your existing account workouts were kept.`);
    setConnection(nextConnection);
    setUploadReady(false);
    setSyncStatus("");
    setConnectionStatus(
      `Paired locally. Checking the dedicated Smolov source before uploading.${adoptionConflicts ? ` ${adoptionConflicts} overlapping workouts remain in unpaired storage; existing account records were kept.` : ""}`,
    );
  };
  const disconnect = async () => {
    if (!canWriteRef.current) {
      setConnectionStatus(
        "Close the other tracker tab before changing connections.",
      );
      return;
    }
    if (stateRef.current?.workouts.some((w) => w.status === "active")) {
      setConnectionStatus(
        "Finish or stop your active workout before changing accounts.",
      );
      return;
    }
    if (stateRef.current)
      await saveAppState(stateRef.current, accountRef.current);
    localStorage.removeItem(CONNECTION_KEY);
    setConnection(null);
    setUploadReady(false);
    setSyncStatus("");
    setConnectionStatus(
      "Disconnected. Account data is retained in its local storage scope.",
    );
  };
  const check = async () => {
    if (!connection) return;
    setConnectionStatus("Checking existing relay…");
    try {
      const result = await checkConnection(connection.code);
      setUploadReady(result.uploadsSupported);
      setConnectionStatus(result.message ?? result.status);
    } catch (e) {
      setConnectionStatus((e as Error).message);
    }
  };
  const saveWorkout = (updated: WorkoutType, autoRest = false) => {
    const saved = mutate((current) => {
      let record = updated;
      if (record.status !== "active") record = finishWorkout(record);
      let next = {
        ...current,
        workouts: current.workouts.map((w) =>
          w.id === record.id ? record : w,
        ),
        timerEnd:
          autoRest && current.settings.autoRest
            ? Date.now() + current.settings.restSeconds * 1000
            : current.timerEnd,
      };
      if (record.status !== "active")
        next = enqueueWorkout(next, record, {
          status: connection ? "pending" : "needs-attention",
          reason: connection
            ? undefined
            : "Pair your existing Powerlevel connection. This workout is saved locally.",
        });
      return next;
    });
    if (updated.status !== "active")
      void saved.then(() => retrySync()).catch(() => undefined);
  };
  const begin = () => {
    const current = stateRef.current;
    if (!current || !session) return;
    const existing = workoutForSession(session, current.workouts) ?? (step?.kind === "workout" && step.session.id === session.id ? step.workout : undefined);
    if (existing) { setWorkoutId(existing.id); return; }
    const active = current.workouts.find(w => w.status === "active");
    if (active) { setWorkoutId(active.id); return; }
    const currentStep = nextTrainingStep(current.workouts, current.settings, new Date(), current.weekReviews);
    if (currentStep.kind !== "workout" || currentStep.session.id !== session.id) return;
    try {
      const next = startSession(session, current.settings, accountId);
      mutate(s => ({ ...s, workouts: [...s.workouts, next] }));
      setWorkoutId(next.id);
      window.scrollTo(0, 0);
    } catch (e) { setNotice((e as Error).message); }
  };
  const confirmWeek = (review: WeekReview) => {
    mutate(current => {
      const currentStep = nextTrainingStep(current.workouts, current.settings, new Date(), current.weekReviews);
      if (currentStep.kind !== "review" || currentStep.weekId !== review.weekId) throw Error("This week's check-in is already saved. Return to your next workout.");
      return { ...current, weekReviews: [...(current.weekReviews ?? []), review] };
    });
    setSelectedSessionId(null);
  };
  const finish = () => {
    if (!workout) return;
    saveWorkout(finishWorkout(workout));
    setWorkoutId(null);
    setSelectedSessionId(null);
    setPage("today");
    setNow(new Date());
    window.scrollTo(0, 0);
  };
  const saveTm = (next: TrainingMax) => {
    if (!tmReview) return;
    mutate((s) => ({
      ...s,
      settings: {
        ...s.settings,
        trainingMaxes: { ...s.settings.trainingMaxes, [tmReview.lift]: next },
      },
    }));
    setTmReview(null);
    setNotice(
      "Training max confirmed. Future unstarted prescriptions updated; saved workout targets are preserved.",
    );
  };
  const step = state ? nextTrainingStep(state.workouts, state.settings, now, state.weekReviews) : null;
  const sessions = state ? trainingSessions(state.workouts, state.settings, state.weekReviews) : [];
  const session: TrainingSession | undefined = selectedSessionId
    ? sessions.find(item => item.id === selectedSessionId)
    : step?.kind === "workout" ? step.session : undefined;
  const workout = state?.workouts.find(w => w.id === workoutId);
  const dayWorkout = session ? workoutForSession(session, state?.workouts ?? []) ?? (step?.kind === "workout" && step.session.id === session.id ? step.workout : undefined) : undefined;
  const active = state?.workouts.some(w => w.status === "active") ?? false;
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const interval = setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(interval); window.removeEventListener("focus", refresh); };
  }, []);
  if (loadError)
    return (
      <main className="loading">
        <h1>Local data needs attention</h1>
        <p className="error" role="alert">
          {loadError}
        </p>
        <p>
          Your stored data has been kept intact. This app has not replaced it
          with defaults.
        </p>
        <button className="secondary" onClick={() => window.location.reload()}>
          Retry opening storage
        </button>
      </main>
    );
  if (!state)
    return (
      <main className="loading">
        <Icon name="weight" size={40} />
        <h1>Opening your tracker…</h1>
        <p>Reading saved workouts.</p>
      </main>
    );
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <Icon name="weight" size={33} />
          <span>SMOLOV / SBD</span>
        </div>
        <span className="header-date">
          {formatDate(workout ? todayDate(new Date(workout.startedAt)) : todayDate(now), {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
          <Icon name="program" size={20} />
        </span>
      </header>
      <nav className="nav" aria-label="Main navigation">
        {(["today", "program", "history", "settings"] as const).map((p) => (
          <button
            key={p}
            aria-current={page === p ? "page" : undefined}
            className={page === p ? "selected" : ""}
            onClick={() => navigate(p)}
          >
            <Icon name={p} />
            {p === "today" ? "Next workout" : p[0].toUpperCase() + p.slice(1)}
          </button>
        ))}
        <div className="nav-foot">
          <strong>One workout at a time.</strong>3 weeks · 1 week off · 3 weeks
          <br />
          New York time
          <br />
          {online ? "Online" : "Offline · local logging"}
        </div>
      </nav>
      <main className="app-main">
        {!canWrite ? (
          <div className="app-alert" role="status">
            {writer.message}
            <button className="text-button" onClick={writer.retry}>
              Retry editing lock
            </button>
          </div>
        ) : null}
        {saveError ? (
          <div className="app-alert" role="alert">
            Local save failed: {saveError}. Keep this tab open until the data is
            saved.
            <button
              className="text-button"
              onClick={() => {
                if (stateRef.current)
                  void commit(stateRef.current).catch(() => undefined);
              }}
            >
              Retry local save
            </button>
          </div>
        ) : null}
        {notice ? (
          <div className="app-alert" role="status">
            {notice}
            <button className="text-button" onClick={() => setNotice("")}>
              Dismiss
            </button>
          </div>
        ) : null}
        {!online ? (
          <div className="pwa-bar">
            <span>Offline · logging stays on this device</span>
            <span>{offlineReady ? "App available offline" : ""}</span>
          </div>
        ) : null}
        {needRefresh ? (
          <div className="pwa-bar">
            <span>
              {active
                ? "Update ready. Finish your workout to apply it."
                : "An app update is ready."}
            </span>
            <button
              className="secondary"
              disabled={
                active || saveStatus === "Saving locally…" || Boolean(saveError)
              }
              onClick={() => void updateServiceWorker(true)}
            >
              Update
            </button>
          </div>
        ) : null}
        {installPrompt ? (
          <div className="pwa-bar">
            <span>Keep Smolov SBD on your home screen.</span>
            <button
              className="secondary"
              onClick={() =>
                void installPrompt.prompt().then(() => setInstallPrompt(null))
              }
            >
              Install
            </button>
          </div>
        ) : null}
        <fieldset
          className="screen-fieldset"
          disabled={
            !canWrite &&
            (Boolean(workout) ||
              (page !== "program" && page !== "history"))
          }
        >
          {workout ? (
            <Workout
              key={workout.id}
              workout={workout}
              settings={state.settings}
              timerEnd={state.timerEnd}
              onTimer={(end) => mutate((s) => ({ ...s, timerEnd: end }))}
              onChange={saveWorkout}
              onBack={() => {
                setWorkoutId(null);
                setPage(workout.status === "active" ? "today" : "history");
              }}
              onFinish={finish}
              onConfirmTm={(id) => {
                try {
                  setTmReview({
                    lift: workout.targets.find((t) => t.id === id)!.lift,
                    initial: confirmCalibrationTrainingMax(workout, id),
                  });
                } catch (e) {
                  setNotice((e as Error).message);
                }
              }}
              saveStatus={saveStatus}
            />
          ) : page === "today" && step ? (
            step.kind === "review" && !selectedSessionId ? (
              <WeekCheckIn key={step.weekId} weekId={step.weekId} session={step.session}
                previousOffsetsLb={step.previousOffsetsLb} sessions={sessions} settings={state.settings}
                onConfirm={confirmWeek} onProgram={() => navigate("program")} />
            ) : <Today
              session={session} step={step} settings={state.settings} workout={dayWorkout}
              canStart={step.kind === "workout" && step.session.id === session?.id}
              onStart={begin} onSettings={() => navigate("settings")} onProgram={() => navigate("program")}
              onSkip={() => setSkipConfirm(true)} onNext={() => navigate("today")}
              saveStatus={saveStatus} paired={Boolean(connection)} uploadReady={uploadReady}
            />
          ) : page === "program" ? (
            <Program settings={state.settings} workouts={state.workouts} weekReviews={state.weekReviews}
              onDay={id => { setSelectedSessionId(id); setPage("today"); window.scrollTo(0, 0); }} />
          ) : page === "history" ? (
            <History
              canEdit={canWrite}
              workouts={state.workouts}
              onOpen={(id) => {
                setWorkoutId(id);
                window.scrollTo(0, 0);
              }}
              onRetry={() => void retrySync(true)}
              syncStatus={syncStatus}
              onProgram={() => navigate("program")}
            />
          ) : (
            <Settings
              state={state}
              accountId={accountId}
              paired={Boolean(connection)}
              onSettings={(s) => mutate((cur) => ({ ...cur, settings: s }))}
              onState={commit}
              onPair={pair}
              onDisconnect={disconnect}
              onCheck={check}
              onRetry={() => void retrySync(true)}
              connectionStatus={connectionStatus}
              syncStatus={syncStatus}
              onTm={(lift) => setTmReview({ lift })}
            />
          )}
        </fieldset>
        {tmReview ? (
          <TmReview
            lift={tmReview.lift}
            initial={tmReview.initial}
            settings={state.settings}
            workouts={state.workouts}
            weekReviews={state.weekReviews}
            onClose={() => setTmReview(null)}
            onSave={saveTm}
          />
        ) : null}
        {skipConfirm && session ? (
          <Modal
            title="Skip this workout"
            onClose={() => setSkipConfirm(false)}
          >
            <p>
              This marks {session.label} as skipped and advances to the next workout. No performed sets are added.
            </p>
            <button
              className="primary"
              onClick={() => {
                const current = stateRef.current;
                if (!current) return;
                const currentStep = nextTrainingStep(current.workouts, current.settings, new Date(), current.weekReviews);
                if (currentStep.kind !== "workout" || currentStep.session.id !== session.id || workoutForSession(session, current.workouts)) { setSkipConfirm(false); return; }
                const next = skipSession(session, current.settings, accountId);
                const saved = mutate((s) =>
                  enqueueWorkout(
                    { ...s, workouts: [...s.workouts, next] },
                    next,
                    { status: connection ? "pending" : "needs-attention" },
                  ),
                );
                setSkipConfirm(false);
                setSelectedSessionId(null);
                setNow(new Date());
                void saved.then(() => retrySync()).catch(() => undefined);
              }}
            >
              Skip & save locally
            </button>
          </Modal>
        ) : null}
      </main>
    </div>
  );
}
