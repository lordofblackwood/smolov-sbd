import type { Workout } from "../domain/types";
import {
  formatDate,
  LIFT_LABELS,
  workoutSummary,
  todayDate,
} from "../domain/program";
import { weightText } from "../ui";
import { Icon } from "../components/Icon";
export function History({
  workouts,
  onOpen,
  onRetry,
  onProgram,
  canEdit = true,
}: {
  workouts: Workout[];
  onOpen: (id: string) => void;
  onRetry: () => void;
  onProgram: () => void;
  canEdit?: boolean;
}) {
  const sorted = [...workouts].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );
  return (
    <>
      <div className="section-heading">
        <h1>Training history</h1>
        {workouts.length > 0 ? (
          <button
            className="icon-button"
            aria-label="Retry pending sync"
            disabled={!canEdit}
            onClick={onRetry}
          >
            <Icon name="sync" />
          </button>
        ) : null}
      </div>
      <p className="subtitle">
        Your actual work, saved with its original targets.
      </p>
      {!sorted.length ? (
        <section className="panel empty">
          <Icon name="history" size={36} />
          <h2>Your first session starts here.</h2>
          <p>
            Logged workouts will appear here. No example sessions are added.
          </p>
          <button className="secondary" onClick={onProgram}>
            View program
          </button>
        </section>
      ) : (
        sorted.map((w) => {
          const s = workoutSummary(w);
          return (
            <section className="panel history-session" key={w.id}>
              <div className="section-heading">
                <div>
                  <h2>
                    {formatDate(todayDate(new Date(w.startedAt)), {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </h2>
                  <p className="muted small">
                    {new Date(w.startedAt).toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: "America/New_York",
                    })}{" "}
                    · New York
                    {todayDate(new Date(w.startedAt)) !== w.date
                      ? ` · Scheduled ${formatDate(w.date, { month: "short", day: "numeric" })}`
                      : ""}
                  </p>
                </div>
                <span className={"status " + w.status}>{w.status}</span>
              </div>
              <p>
                {s.completedSets} complete · {s.failedSets} failed ·{" "}
                {s.skippedSets} skipped
                {s.remainingSets ? ` · ${s.remainingSets} unlogged` : ""}
              </p>
              <p className="muted">
                {s.completedReps} completed reps · {s.actualReps} performed reps
              </p>
              <details>
                <summary>
                  Planned vs performed · {s.loggedSets}/{s.plannedSets}
                </summary>
                <div className="history-sets">
                  {w.targets.map((t) => {
                    const actual = w.sets.find((s) => s.targetId === t.id);
                    return (
                      <div key={t.id}>
                        <strong>
                          {LIFT_LABELS[t.lift]}{" "}
                          {t.kind === "warmup" ? "warm-up " : ""}#{t.setNumber}
                        </strong>
                        <span className="muted">
                          Target: {weightText(t.weight)} {t.unit} × {t.reps}
                          {t.rpeTarget ? ` · RPE ${t.rpeTarget}` : ""}
                        </span>
                        <span>
                          {actual
                            ? actual.outcome === "skipped"
                              ? "Skipped · 0 reps"
                              : `${weightText(actual.weight)} ${actual.unit} × ${actual.reps} · ${actual.outcome}${actual.rpe !== undefined ? ` · RPE ${actual.rpe}` : ""}`
                            : "Unlogged · no performed reps"}
                        </span>
                        {actual?.notes || actual?.pain ? (
                          <small>
                            {actual.pain ? "Pain / discomfort · " : ""}
                            {actual.notes}
                          </small>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </details>
              {w.notes ? <p className="small">{w.notes}</p> : null}
              <div className="history-sync">
                <Icon name="link" size={18} />
                <span className={"status " + w.sync.status}>
                  {w.sync.status === "needs-attention"
                    ? "Sync needs attention"
                    : w.sync.status === "local"
                      ? "Saved locally"
                      : w.sync.status}
                </span>
              </div>
              {w.sync.error ? (
                <p className="muted small">{w.sync.error}</p>
              ) : null}
              <button className="secondary full" disabled={!canEdit} onClick={() => onOpen(w.id)}>
                {w.status === "active"
                  ? "Resume workout"
                  : "Review / correct sets"}
                <Icon name="arrow" />
              </button>
            </section>
          );
        })
      )}
    </>
  );
}
