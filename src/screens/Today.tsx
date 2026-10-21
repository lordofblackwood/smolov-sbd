import type { Settings, Workout } from "../domain/types";
import {
  calculateWorkingWeight,
  formatRule,
  LIFT_LABELS,
  workoutSummary,
} from "../domain/program";
import type { TrainingSession, TrainingStep } from "../domain/sequence";
import { weightText } from "../ui";
import { Icon } from "../components/Icon";

export function Today({
  session, step, settings, workout, canStart, onStart, onSettings,
  onProgram, onSkip, onNext, saveStatus, paired, uploadReady,
}: {
  session?: TrainingSession;
  step: TrainingStep;
  settings: Settings;
  workout?: Workout;
  canStart: boolean;
  onStart: () => void;
  onSettings: () => void;
  onProgram: () => void;
  onSkip: () => void;
  onNext: () => void;
  saveStatus: string;
  paired: boolean;
  uploadReady: boolean;
}) {
  const summary = workout ? workoutSummary(workout) : null;
  const missing = session ? [...new Set(session.blocks.filter(b => b.percent !== undefined && !settings.trainingMaxes[b.lift]).map(b => b.lift))] : [];
  const recovery = !session && step.kind === "recovery" ? step : null;
  return (
    <>
      <section className="training-heading">
        <div>
          <h1>{session && !canStart && !workout ? "Workout preview" : recovery ? "Recovery week" : "Next workout"}</h1>
          <span className={"phase-tag " + (session?.phase ?? "")}>
            {session?.label ?? (recovery ? "Between cycles" : "Program complete")}
          </span>
        </div>
        <div className="cycle-summary">
          <strong>3 weeks · 1 week off · 3 weeks</strong>
          <span>One workout at a time</span>
        </div>
      </section>
      <div className="phase-track cycle-track" aria-label="Program phases">
        {[{ id: "1", label: "Cycle 1", detail: "3 training weeks" }, { id: "break", label: "Recovery", detail: "7 days off" }, { id: "2", label: "Cycle 2", detail: "3 training weeks" }].map(p => (
          <button key={p.id} className={(session?.cycle === Number(p.id) || (recovery && p.id === "break")) ? "selected" : ""} onClick={onProgram}>
            <i /><strong>{p.label}</strong><span>{p.detail}</span>
          </button>
        ))}
      </div>
      <section className="panel today-lifts">
        <div className="section-heading">
          <h2>{session ? "Prescribed lifts" : recovery ? "Take a full week off" : "Both cycles finished"}</h2>
          {workout ? <span className={"status " + workout.status}>{workout.status}</span> : session?.week ? <span className="muted small">Workout {session.sessionNumber} of 6</span> : null}
        </div>
        {session?.blocks.map((b, i) => {
          const saved = workout?.targets.find(target => target.blockId === b.id);
          const pending = session.adjustmentPending && !workout;
          const weight = saved ? saved.weight : pending ? null : calculateWorkingWeight(b, settings);
          const unit = saved ? saved.unit : settings.unit;
          return (
            <div className="lift-row" key={b.id}>
              <span className="lift-number">{String(i + 1).padStart(2, "0")}</span>
              <div className="lift-info">
                <h3>{LIFT_LABELS[b.lift]}</h3>
                <strong>{b.sets} × {b.reps}</strong>
                <span>{saved ? saved.rule : pending ? `${b.percent}% TM · adjustment at week start` : b.rpeTarget ? `Target RPE ${b.rpeTarget}` : formatRule(b)}</span>
              </div>
              <div className="lift-weight">
                <strong>{weightText(weight)}<small> {unit}</small></strong>
                <span>{b.rpeTarget ? "Enter actual single" : pending ? "Weekly check-in first" : settings.trainingMaxes[b.lift] ? "Working weight" : "Confirm training max"}</span>
              </div>
            </div>
          );
        })}
        {session?.optionalAccessories ? <p className="optional-note">{session.optionalAccessories}. Log these as optional notes.</p> : null}
        {recovery ? (
          <div className="recovery">
            <Icon name="weight" size={36} />
            <h3>{recovery.remainingDays} {recovery.remainingDays === 1 ? "day" : "days"} remaining</h3>
            <p>Cycle 2 becomes available {new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(recovery.endsAt))}. Your next workout will wait for you.</p>
          </div>
        ) : !session ? (
          <div className="recovery"><h3>Your training is saved.</h3><p>Review your completed work in History or export a backup from Settings.</p></div>
        ) : null}
        {summary ? (
          <div className="progress-block">
            <div><span>{summary.loggedSets} of {summary.plannedSets} sets logged</span><span>{summary.completedReps} completed reps</span></div>
            <progress value={summary.loggedSets} max={summary.plannedSets || 1} />
          </div>
        ) : null}
        {session && (canStart || workout) ? (
          <>
            <button className="primary" onClick={missing.length && !workout ? onSettings : onStart}>
              {workout?.status === "active" ? "Resume workout" : workout ? "View workout" : missing.length ? "Confirm training maxes" : "Start workout"}<Icon name="arrow" />
            </button>
            {!workout ? <button className="text-button" onClick={onSkip}>Skip this workout</button> : null}
            {session.kind === "calibration" && !workout ? <p className="center muted small">One successful single per lift at RPE 6–8. Already calibrated? Confirm your existing singles in Settings.</p> : null}
          </>
        ) : session ? (
          <>
            <p className="muted small preview-note">Complete the earlier workouts and your weekly check-in to reach this session.</p>
            <button className="secondary full" onClick={onNext}>Back to next workout <Icon name="arrow" /></button>
          </>
        ) : <button className="secondary full" onClick={onProgram}>View full program <Icon name="arrow" /></button>}
      </section>
      <p className="muted small training-note">Aim for six workouts per training week, then rest. Your place advances when you finish or explicitly skip a session.</p>
      <button className="panel connection-row" onClick={onSettings}>
        <Icon name="link" size={27} />
        <div><h2>Powerlevel</h2><span>{paired ? uploadReady ? "Dedicated Smolov source ready" : "Check your connection in Settings" : "Pair your existing account"}</span></div>
        <span className="status needs-attention">{paired ? uploadReady ? "Ready to sync" : "Needs attention" : "Not connected"}</span>
        <Icon name="arrow" size={18} />
      </button>
      <div className="save-line"><span className="save-dot" />{saveStatus}<span>America/New_York</span></div>
    </>
  );
}
