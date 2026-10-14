import type { AppState } from "../storage/types";
import type { MeetAttempt, Unit } from "../domain/types";
import {
  emptyMeetAttempts,
  LIFTS,
  LIFT_LABELS,
  meetTotal,
} from "../domain/program";
import { weightText } from "../ui";
import { Icon } from "../components/Icon";
export function Meet({
  meet,
  onChange,
  onBack,
}: {
  meet: AppState["meet"];
  onChange: (meet: AppState["meet"]) => void;
  onBack: () => void;
}) {
  const attempts = meet.attempts.length
    ? meet.attempts
    : emptyMeetAttempts(meet.unit);
  const total = meetTotal(attempts, meet.unit);
  const update = (id: string, patch: Partial<MeetAttempt>) =>
    onChange({
      ...meet,
      attempts: attempts.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    });
  return (
    <>
      <button className="text-button back" onClick={onBack}>
        <Icon name="back" /> Back to program
      </button>
      <h1>Meet day</h1>
      <p className="subtitle">Sunday, November 15, 2026</p>
      <label>
        Official meet unit
        <select
          value={meet.unit}
          onChange={(e) =>
            onChange({
              unit: e.target.value as Unit,
              attempts: attempts.map((a) =>
                a.weight === null ? { ...a, unit: e.target.value as Unit } : a,
              ),
            })
          }
        >
          <option value="lb">Pounds (lb)</option>
          <option value="kg">Kilograms (kg)</option>
        </select>
      </label>
      <section className="panel meet-total">
        <h2>
          {total.valid ? "Three-lift total" : "Awaiting successful lifts"}
        </h2>
        <strong>
          {weightText(total.total)} <small>{meet.unit}</small>
        </strong>
        <p className="muted">
          {total.valid
            ? "Best successful attempt in each lift."
            : "A valid official total needs at least one good lift in squat, bench, and deadlift."}
        </p>
        <div>
          {LIFTS.map((l) => (
            <span key={l}>
              {LIFT_LABELS[l]} <b>{weightText(total.best[l])}</b>
            </span>
          ))}
        </div>
      </section>
      {LIFTS.map((l) => (
        <section className="panel meet-lift" key={l}>
          <h2>{LIFT_LABELS[l]}</h2>
          {attempts
            .filter((a) => a.lift === l)
            .map((a) => (
              <div className="attempt" key={a.id}>
                <h3>Attempt {a.number}</h3>
                <div className="attempt-inputs">
                  <label>
                    Weight
                    <input
                      aria-label={`${LIFT_LABELS[l]} attempt ${a.number} weight`}
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min="0"
                      value={a.weight ?? ""}
                      onChange={(e) =>
                        update(a.id, {
                          weight:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Unit
                    <select
                      aria-label={`${LIFT_LABELS[l]} attempt ${a.number} unit`}
                      value={a.unit}
                      onChange={(e) =>
                        update(a.id, { unit: e.target.value as Unit })
                      }
                    >
                      <option>lb</option>
                      <option>kg</option>
                    </select>
                  </label>
                  <label>
                    Result
                    <select
                      aria-label={`${LIFT_LABELS[l]} attempt ${a.number} result`}
                      value={a.outcome}
                      onChange={(e) =>
                        update(a.id, {
                          outcome: e.target.value as MeetAttempt["outcome"],
                        })
                      }
                    >
                      <option value="not-taken">Not taken</option>
                      <option value="good">Good lift</option>
                      <option value="no-lift">No lift</option>
                    </select>
                  </label>
                </div>
                {a.outcome === "good" && (!a.weight || a.weight <= 0) ? (
                  <p className="error">
                    Enter a positive weight for this good lift.
                  </p>
                ) : null}
                <label className="small">
                  Attempt notes
                  <input
                    aria-label={`${LIFT_LABELS[l]} attempt ${a.number} notes`}
                    value={a.notes}
                    onChange={(e) => update(a.id, { notes: e.target.value })}
                    placeholder="Optional"
                  />
                </label>
              </div>
            ))}
        </section>
      ))}
      <p className="muted small">
        Attempts stay local until the service supports meet outcomes. No
        attempts or RPE are prescribed.
      </p>
    </>
  );
}
