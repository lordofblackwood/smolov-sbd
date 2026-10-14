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
  const description = (day: ProgramDay) =>
    day.blocks
      .map((block) => {
        const weight = calculateWorkingWeight(block, settings);
        return `${LIFT_LABELS[block.lift]} ${block.sets} × ${block.reps} · ${formatRule(block)}${weight === null ? "" : ` · ${weightText(weight)} ${settings.unit}`}`;
      })
      .join("; ");
  return (
    <section
      className="panel schedule-revision"
      aria-label="Volume schedule update"
    >
      <h2>Volume schedule update</h2>
      <p>
        Bench follows light deadlifts on Thursday: 5 × 3 at 85% TM. Saturday is
        squat only. Squat and bench pair on Tuesday, Wednesday and Friday.
      </p>
      <p className="muted small">
        6 lifting days · 69 squat / 69 bench / 33 deadlift reps. Saved workouts
        keep their original targets. Unstarted days in a volume week begun under
        the original layout keep those pairings to avoid duplicating moved work.
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
