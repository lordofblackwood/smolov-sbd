import type { ProgramDay, Settings, Workout } from "../domain/types";
import {
  calculateWorkingWeight,
  formatDate,
  formatRule,
  LIFT_LABELS,
  MEET_DATE,
  missingTrainingMaxes,
  workoutSummary,
} from "../domain/program";
import { phases, phaseShort, weightText } from "../ui";
import { Icon } from "../components/Icon";
export function Today({
  day,
  settings,
  workout,
  onStart,
  onSettings,
  onProgram,
  onSkip,
  onMeet,
  saveStatus,
  paired,
  uploadReady,
}: {
  day: ProgramDay | undefined;
  settings: Settings;
  workout?: Workout;
  onStart: () => void;
  onSettings: () => void;
  onProgram: () => void;
  onSkip: () => void;
  onMeet: () => void;
  saveStatus: string;
  paired: boolean;
  uploadReady: boolean;
}) {
  const days = day
    ? Math.max(
        0,
        Math.round(
          (Date.parse(MEET_DATE + "T12:00Z") -
            Date.parse(day.date + "T12:00Z")) /
            86400000,
        ),
      )
    : 0;
  const summary = workout ? workoutSummary(workout) : null;
  const missing = day ? missingTrainingMaxes(day, settings) : [];
  return (
    <>
      <section className="training-heading">
        <div>
          <h1>Today’s training</h1>
          <span className={"phase-tag " + (day?.phase ?? "")}>
            {day ? phaseShort[day.phase] : "Program complete"}
          </span>
        </div>
        <div className="meet-countdown">
          <strong>{days} days to the platform</strong>
          <span>Nov 15 · Meet day</span>
        </div>
      </section>
      <div className="phase-track" aria-label="Program phases">
        {phases.map((p) => (
          <button
            key={p.id}
            className={day?.phase === p.id ? "selected" : ""}
            onClick={onProgram}
          >
            <i />
            <strong>{p.label}</strong>
            <span>{p.date}</span>
          </button>
        ))}
      </div>
      <section className="panel today-lifts">
        <div className="section-heading">
          <h2>
            {day?.blocks.length
              ? "Today’s lifts"
              : day?.phase === "meet"
                ? "On the platform"
                : "Recovery day"}
          </h2>
          {workout ? (
            <span className={"status " + workout.status}>{workout.status}</span>
          ) : (
            <span className="muted">
              {day
                ? formatDate(day.date, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })
                : "Nov 15, 2026"}
            </span>
          )}
        </div>
        {day?.blocks.map((b, i) => (
          <div className="lift-row" key={b.id}>
            <span className="lift-number">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="lift-info">
              <h3>{LIFT_LABELS[b.lift]}</h3>
              <strong>
                {b.sets} × {b.reps}
              </strong>
              <span>
                {b.rpeTarget ? `Target RPE ${b.rpeTarget}` : formatRule(b)}
              </span>
            </div>
            <div className="lift-weight">
              <strong>
                {weightText(
                  workout?.targets.find((t) => t.blockId === b.id)?.weight ??
                    calculateWorkingWeight(b, settings),
                )}
                <small>
                  {" "}
                  {workout?.targets.find((t) => t.blockId === b.id)?.unit ??
                    settings.unit}
                </small>
              </strong>
              <span>
                {b.rpeTarget
                  ? "Enter actual single"
                  : settings.trainingMaxes[b.lift]
                    ? "Working weight"
                    : "Confirm training max"}
              </span>
            </div>
          </div>
        ))}
        {day?.recovery ? (
          <div className="recovery">
            <Icon name="weight" size={36} />
            <h3>{day.recovery}</h3>
            <p>No prescribed lifting today.</p>
          </div>
        ) : null}
        {!day ? (
          <div className="recovery">
            <h3>Your program runs October 14–November 15.</h3>
            <p>Open the program to review any day or your meet attempts.</p>
          </div>
        ) : null}
        {day?.optionalAccessories ? (
          <p className="optional-note">
            {day.optionalAccessories}. Log these as optional notes.
          </p>
        ) : null}
        {summary ? (
          <div className="progress-block">
            <div>
              <span>
                {summary.loggedSets} of {summary.plannedSets} sets logged
              </span>
              <span>{summary.completedReps} completed reps</span>
            </div>
            <progress
              value={summary.loggedSets}
              max={summary.plannedSets || 1}
            />
          </div>
        ) : null}
        {day?.phase === "meet" ? (
          <button className="primary" onClick={onMeet}>
            Log meet attempts <Icon name="arrow" />
          </button>
        ) : day?.blocks.length ? (
          <>
            <button
              className="primary"
              onClick={missing.length && !workout ? onSettings : onStart}
            >
              {workout?.status === "active"
                ? "Resume workout"
                : workout
                  ? "View workout"
                  : missing.length
                    ? "Confirm training maxes"
                    : "Start workout"}
              <Icon name="arrow" />
            </button>
            {!workout && (
              <button className="text-button" onClick={onSkip}>
                Skip this workout
              </button>
            )}
            {!workout && day.phase === "calibration" ? (
              <p className="center muted small">
                Training maxes come from your calibration singles.
              </p>
            ) : null}
            {missing.length && !workout ? (
              <p className="center muted small">
                Enter or confirm your actual{" "}
                {missing.map((l) => LIFT_LABELS[l].toLowerCase()).join(" and ")}{" "}
                calibration single first.
              </p>
            ) : null}
          </>
        ) : (
          <button className="secondary full" onClick={onProgram}>
            View full program <Icon name="arrow" />
          </button>
        )}
      </section>
      <button className="panel connection-row" onClick={onSettings}>
        <Icon name="link" size={27} />
        <div>
          <h2>Powerlevel</h2>
          <span>
            {paired
              ? uploadReady
                ? "Dedicated Smolov source ready"
                : "Check your connection in Settings"
              : "Pair your existing account"}
          </span>
        </div>
        <span className="status needs-attention">
          {paired
            ? uploadReady
              ? "Ready to sync"
              : "Needs attention"
            : "Not connected"}
        </span>
        <Icon name="arrow" size={18} />
      </button>
      <div className="save-line">
        <span className="save-dot" />
        {saveStatus}
        <span>America/New_York</span>
      </div>
    </>
  );
}
