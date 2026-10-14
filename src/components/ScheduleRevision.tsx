import type { ProgramDay, Settings, Workout } from "../domain/types";
import {
  calculateWorkingWeight,
  formatDate,
  formatRule,
  LIFT_LABELS,
  previewScheduleChanges,
} from "../domain/program";
import { weightText } from "../ui";
export function ScheduleRevision({
  workouts,
  settings,
}: {
  workouts: Workout[];
  settings: Settings;
}) {
  const changes = previewScheduleChanges(workouts);
  if (!changes.length) return null;
  const calibrationChanged = changes.some(
    (change) => change.after.phase === "calibration",
  );
  const volumeChanged = changes.some((change) =>
    change.after.phase.startsWith("volume-"),
  );
  const description = (day: ProgramDay) =>
    day.blocks.length
      ? day.blocks
          .map((block) => {
            const weight = calculateWorkingWeight(block, settings);
            return `${LIFT_LABELS[block.lift]} ${block.sets} × ${block.reps} · ${formatRule(block)}${weight === null ? "" : ` · ${weightText(weight)} ${settings.unit}`}`;
          })
          .join("; ")
      : (day.recovery ?? "Recovery");
  return (
    <section className="panel schedule-revision" aria-label="Schedule update">
      <h2>Schedule update</h2>
      {calibrationChanged ? (
        <p>
          All three calibration tests are Friday, October 16: squat, bench, then
          deadlift. Each is one single at RPE 6–8. Wednesday, Thursday and the
          weekend are recovery days. Volume week 1 starts Monday, October 19.
        </p>
      ) : null}
      {volumeChanged ? (
        <p>
          Bench follows light deadlifts on Thursday: 5 × 3 at 85% TM. Saturday
          is squat only. Squat and bench pair on Tuesday, Wednesday and Friday.
        </p>
      ) : null}
      <p className="muted small">
        {volumeChanged
          ? "6 lifting days · 69 squat / 69 bench / 33 deadlift reps. "
          : ""}
        Saved workouts keep their dates and targets. Unstarted days in a
        calibration phase or volume week begun under the original schedule keep
        those dates and pairings to avoid repeating moved work.
      </p>
      <details>
        <summary>Preview {changes.length} future changed days</summary>
        <div className="schedule-changes">
          {changes.map((change) => (
            <div key={change.date}>
              <h3>
                {formatDate(change.date, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              </h3>
              <p>
                <span className="muted">Before:</span>{" "}
                {description(change.before)}
              </p>
              <p>
                <span className="muted">Now:</span> {description(change.after)}
              </p>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
