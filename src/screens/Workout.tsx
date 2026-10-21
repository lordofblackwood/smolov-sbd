import { useState } from "react";
import type {
  LoggedSet,
  SetTarget,
  Settings,
  Workout as WorkoutType,
} from "../domain/types";
import {
  addWarmup,
  confirmCalibrationTrainingMax,
  LIFT_LABELS,
  logSet,
  undoSet,
  workoutSummary,
} from "../domain/program";
import { weightText } from "../ui";
import { Icon } from "../components/Icon";
import { Modal } from "../components/Modal";
import { RestTimer } from "../components/RestTimer";
function SetRow({
  target,
  logged,
  onLog,
  onUndo,
  isCurrent = false,
}: {
  target: SetTarget;
  logged?: LoggedSet;
  onLog: (set: LoggedSet) => void;
  onUndo: () => void;
  isCurrent?: boolean;
}) {
  const [weight, setWeight] = useState(
    logged
      ? String(logged.weight)
      : target.weight === null
        ? ""
        : String(target.weight),
  );
  const [reps, setReps] = useState(String(logged?.reps ?? target.reps));
  const [rpe, setRpe] = useState(
    logged?.rpe === undefined ? "" : String(logged.rpe),
  );
  const [notes, setNotes] = useState(logged?.notes ?? "");
  const [pain, setPain] = useState(logged?.pain ?? false);
  const [editing, setEditing] = useState(!logged);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState(false);
  const [failedReps, setFailedReps] = useState("0");
  const submit = (outcome: LoggedSet["outcome"], actualReps?: string) => {
    try {
      const n = Number(actualReps ?? reps);
      if (
        outcome !== "skipped" &&
        (weight.trim() === "" ||
          !Number.isFinite(Number(weight)) ||
          Number(weight) <= 0)
      )
        throw Error("Enter the actual weight lifted.");
      if (
        outcome !== "skipped" &&
        ((actualReps ?? reps).trim() === "" || !Number.isInteger(n) || n < 0)
      )
        throw Error("Enter actual whole reps.");
      const record: LoggedSet = {
        id: logged?.id ?? crypto.randomUUID(),
        targetId: target.id,
        lift: target.lift,
        weight: outcome === "skipped" ? 0 : Number(weight),
        unit: target.unit,
        reps: outcome === "skipped" ? 0 : n,
        outcome,
        ...(target.rpeTarget && rpe.trim() !== "" ? { rpe: Number(rpe) } : {}),
        notes,
        pain,
        loggedAt: new Date().toISOString(),
      };
      onLog(record);
      setEditing(false);
      setFailed(false);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div
      className={
        "set-row " +
        (isCurrent ? "current-set " : "") +
        (logged && !editing ? "logged " + logged.outcome : "")
      }
    >
      <div className="section-heading">
        <h3>Set {target.setNumber}</h3>
        <span className="target-label">
          {target.rpeTarget
            ? `Target RPE ${target.rpeTarget}`
            : `Planned ${weightText(target.weight)} ${target.unit} × ${target.reps}`}
        </span>
      </div>
      {logged && !editing ? (
        <>
          <div className="logged-result">
            <Icon
              name={
                logged.outcome === "complete"
                  ? "check"
                  : logged.outcome === "failed"
                    ? "close"
                    : "arrow"
              }
            />
            <strong>
              {logged.outcome === "skipped"
                ? "Skipped"
                : `${weightText(logged.weight)} ${logged.unit} × ${logged.reps}`}
            </strong>
            <span>
              {logged.outcome === "complete"
                ? "Complete"
                : logged.outcome === "failed"
                  ? "Failed"
                  : "0 performed reps"}
            </span>
            {logged.rpe !== undefined ? <span>RPE {logged.rpe}</span> : null}
          </div>
          {logged.notes || logged.pain ? (
            <p className="small muted">
              {logged.pain ? "Pain/discomfort noted. " : ""}
              {logged.notes}
            </p>
          ) : null}
          <div className="inline-actions">
            <button className="text-button" onClick={() => setEditing(true)}>
              Edit set
            </button>
            <button
              className="text-button"
              onClick={() => {
                onUndo();
                setEditing(true);
              }}
            >
              Undo
            </button>
          </div>
        </>
      ) : (
        <>
          <div className={"set-inputs " + (target.rpeTarget ? "with-rpe" : "")}>
            <label>
              Actual weight ({target.unit})
              <input
                aria-label={`${LIFT_LABELS[target.lift]} set ${target.setNumber} actual weight`}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={weight}
                placeholder="—"
                onChange={(e) => setWeight(e.target.value)}
              />
            </label>
            <label>
              Actual reps
              <input
                aria-label={`${LIFT_LABELS[target.lift]} set ${target.setNumber} actual reps`}
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                value={reps}
                onChange={(e) => setReps(e.target.value)}
              />
            </label>
            {target.rpeTarget ? (
              <label>
                Achieved RPE
                <input
                  type="number"
                  aria-label={`${LIFT_LABELS[target.lift]} achieved RPE`}
                  inputMode="decimal"
                  min="1"
                  max="10"
                  step="0.5"
                  value={rpe}
                  placeholder="—"
                  onChange={(e) => setRpe(e.target.value)}
                />
              </label>
            ) : null}
          </div>
          <details className="set-notes">
            <summary>Notes & discomfort</summary>
            <label>
              Set notes
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add a note…"
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={pain}
                onChange={(e) => setPain(e.target.checked)}
              />{" "}
              Pain / discomfort
            </label>
          </details>
          {error ? (
            <p role="alert" className="error">
              {error}
            </p>
          ) : null}
          <button
            className="primary"
            aria-label={`Complete ${LIFT_LABELS[target.lift]} set ${target.setNumber}`}
            onClick={() => submit("complete")}
          >
            {logged ? "Save completed set" : "Complete set"}
            <Icon name="arrow" />
          </button>
          <div className="outcome-actions">
            <button
              className="secondary"
              onClick={() => {
                setFailedReps(
                  logged?.outcome === "failed" ? String(logged.reps) : "0",
                );
                setFailed(true);
              }}
            >
              Failed
            </button>
            <button className="secondary" onClick={() => submit("skipped")}>
              Skip
            </button>
          </div>
        </>
      )}
      {failed ? (
        <Modal title="Record a failed set" onClose={() => setFailed(false)}>
          <p>Record only the reps actually performed.</p>
          <label>
            Actual reps performed
            <input
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              value={failedReps}
              onChange={(e) => setFailedReps(e.target.value)}
            />
          </label>
          {error ? (
            <p role="alert" className="error">
              {error}
            </p>
          ) : null}
          <button
            className="primary"
            onClick={() => submit("failed", failedReps)}
          >
            Save failed set
          </button>
        </Modal>
      ) : null}
    </div>
  );
}
export function Workout({
  workout,
  settings,
  timerEnd,
  onChange,
  onTimer,
  onBack,
  onFinish,
  onConfirmTm,
  saveStatus,
}: {
  workout: WorkoutType;
  settings: Settings;
  timerEnd: number | null;
  onChange: (workout: WorkoutType, autoRest?: boolean) => void;
  onTimer: (end: number | null) => void;
  onBack: () => void;
  onFinish: () => void;
  onConfirmTm: (targetId: string) => void;
  saveStatus: string;
}) {
  const groups = workout.targets
    .filter((t) => t.kind !== "warmup")
    .reduce<Record<string, SetTarget[]>>((a, t) => {
      (a[t.blockId] ??= []).push(t);
      return a;
    }, {});
  const summary = workoutSummary(workout);
  const [activeBlock, setActiveBlock] = useState(
    Object.keys(groups).find((id) =>
      groups[id].some((t) => !workout.sets.some((s) => s.targetId === t.id)),
    ) ?? Object.keys(groups)[0],
  );
  const [finish, setFinish] = useState(false);
  const [error, setError] = useState("");
  const current = groups[activeBlock] ?? Object.values(groups)[0];
  const nextBlock =
    Object.keys(groups)[Object.keys(groups).indexOf(activeBlock) + 1];
  const firstUnlogged = current.find(
    (t) => !workout.sets.some((s) => s.targetId === t.id),
  )?.id;
  const changeLog = (set: LoggedSet) => {
    const next = logSet(workout, set);
    onChange(next, set.outcome === "complete" && workout.status === "active");
  };
  return (
    <>
      <button className="text-button back" onClick={onBack}>
        <Icon name="back" />{" "}
        {workout.status === "active" ? "Back to next workout" : "Back to history"}
      </button>
      <div className="section-heading">
        <div>
          <h1>{LIFT_LABELS[current[0].lift]}</h1>
          <p className="subtitle">{current[0].rule}</p>
        </div>
        <span className={"status " + workout.status}>{workout.status}</span>
      </div>
      <div
        className="exercise-tabs"
        role="group"
        aria-label="Exercises in prescribed order"
      >
        {Object.entries(groups).map(([id, sets], i) => (
          <button
            key={id}
            className={activeBlock === id ? "selected" : ""}
            onClick={() => setActiveBlock(id)}
          >
            <span>{i + 1}</span>
            {LIFT_LABELS[sets[0].lift]}
            {sets[0].kind === "working" &&
            Object.values(groups).filter((g) => g[0].lift === sets[0].lift)
              .length > 1 ? (
              <small>{sets[0].reps === 1 ? "Single" : "Back-off"}</small>
            ) : null}
          </button>
        ))}
      </div>
      <div className="progress-block">
        <div>
          <span>
            {summary.loggedSets} of {summary.plannedSets} sets logged
          </span>
          <span>{summary.completedReps} completed reps</span>
        </div>
        <progress value={summary.loggedSets} max={summary.plannedSets || 1} />
      </div>
      <section className="panel workout-sets">
        {current.map((t) => (
          <div key={t.id}>
            <SetRow
              key={
                t.id +
                (workout.sets.some((s) => s.targetId === t.id)
                  ? ":logged"
                  : ":open")
              }
              isCurrent={workout.status === "active" && t.id === firstUnlogged}
              target={t}
              logged={workout.sets.find((s) => s.targetId === t.id)}
              onLog={changeLog}
              onUndo={() => onChange(undoSet(workout, t.id))}
            />
            {t.kind === "calibration" &&
            workout.sets.some(
              (s) => s.targetId === t.id && s.outcome === "complete",
            ) ? (
              <button
                className="secondary confirm-tm"
                onClick={() => {
                  try {
                    confirmCalibrationTrainingMax(workout, t.id);
                    onConfirmTm(t.id);
                    setError("");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Review & confirm this single as TM
              </button>
            ) : null}
          </div>
        ))}
      </section>
      {!firstUnlogged && nextBlock ? (
        <button
          className="primary full"
          onClick={() => {
            setActiveBlock(nextBlock);
            window.scrollTo(0, 0);
          }}
        >
          Next: {LIFT_LABELS[groups[nextBlock][0].lift]} <Icon name="arrow" />
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      <details className="panel warmups">
        <summary>Warm-up sets (optional)</summary>
        <p className="small muted">
          Separate from working sets. No RPE required.
        </p>
        {workout.targets
          .filter((t) => t.kind === "warmup" && t.lift === current[0].lift)
          .map((t) => (
            <SetRow
              key={
                t.id +
                (workout.sets.some((s) => s.targetId === t.id)
                  ? ":logged"
                  : ":open")
              }
              target={t}
              logged={workout.sets.find((s) => s.targetId === t.id)}
              onLog={changeLog}
              onUndo={() => onChange(undoSet(workout, t.id))}
            />
          ))}
        <button
          className="secondary full"
          onClick={() =>
            onChange(
              addWarmup(workout, current[0].lift, 1, null, settings.unit),
            )
          }
        >
          Add {LIFT_LABELS[current[0].lift].toLowerCase()} warm-up
        </button>
      </details>
      <RestTimer
        end={timerEnd}
        seconds={settings.restSeconds}
        onChange={onTimer}
      />
      <label className="session-notes">
        Workout notes / optional accessories
        <textarea
          value={workout.notes}
          placeholder="Add a note…"
          onChange={(e) =>
            onChange({
              ...workout,
              notes: e.target.value,
              revision: workout.revision + 1,
              updatedAt: new Date().toISOString(),
            })
          }
        />
      </label>
      {workout.status === "active" ? (
        <button
          className="secondary full finish-button"
          onClick={() => setFinish(true)}
        >
          <Icon name="flag" />
          Finish / stop workout <Icon name="arrow" />
        </button>
      ) : (
        <p className="muted small">
          Edits preserve your original targets and are queued as corrections.
          Sync status: {workout.sync.status}.
        </p>
      )}
      <div className="save-line">
        <span className="save-dot" />
        {saveStatus}
      </div>
      {finish ? (
        <Modal title="Finish workout" onClose={() => setFinish(false)}>
          <p>Your actual working sets:</p>
          <div className="summary-numbers">
            <div>
              <strong>{summary.completedSets}</strong>
              <span>complete</span>
            </div>
            <div>
              <strong>{summary.failedSets}</strong>
              <span>failed</span>
            </div>
            <div>
              <strong>{summary.skippedSets}</strong>
              <span>skipped</span>
            </div>
          </div>
          <p>
            {summary.completedReps} completed reps · {summary.actualReps} total
            performed reps.
          </p>
          {summary.remainingSets > 0 ? (
            <p className="muted">
              {summary.remainingSets} sets remain unlogged. They will stay
              unperformed.
            </p>
          ) : null}
          <p className="small muted">
            Your finished session saves locally before entering the Powerlevel
            queue. Sync needs a paired, supported connection. No make-up volume
            is added.
          </p>
          <button
            className="primary"
            onClick={() => {
              setFinish(false);
              onFinish();
            }}
          >
            Finish & save locally <Icon name="check" />
          </button>
        </Modal>
      ) : null}
    </>
  );
}
