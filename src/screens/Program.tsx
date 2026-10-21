import { useState } from "react";
import type { Settings, WeekReview, Workout } from "../domain/types";
import { trainingSessions, workoutForSession, nextTrainingStep, WEEK_FEELING_ADJUSTMENTS, WEEK_FEELING_LABELS } from "../domain/sequence";
import { LIFT_LABELS, calculateWorkingWeight, formatRule, prescribedReps } from "../domain/program";
import { weightText } from "../ui";
import { Icon } from "../components/Icon";

export function Program({ settings, workouts, weekReviews = [], onDay }: {
  settings: Settings;
  workouts: Workout[];
  weekReviews?: WeekReview[];
  onDay: (id: string) => void;
}) {
  const [cycle, setCycle] = useState("all");
  const sessions = trainingSessions(workouts, settings, weekReviews);
  const step = nextTrainingStep(workouts, settings, new Date(), weekReviews);
  const visible = sessions.filter(s => cycle === "all" || String(s.cycle) === cycle);
  const totals = prescribedReps(sessions.filter(s => s.cycle === 1 && s.week === 1).map(s => ({ ...s, date: s.legacyDate ?? "2026-10-19" })));
  return (
    <>
      <h1>Your program</h1>
      <p className="subtitle">Modified Smolov Jr. — SBD Training Cycles</p>
      <div className="section-heading program-meta"><span>3 weeks · 1 week off · 3 weeks</span><span className="muted">36 workouts · no fixed dates</span></div>
      <p className="muted small">Finish each workout in order. At the start of each new week, choose how each lift felt to set its next weight adjustment.</p>
      <label className="filter-label">Cycle<select value={cycle} onChange={e => setCycle(e.target.value)}><option value="all">All cycles</option><option value="1">Cycle 1</option><option value="2">Cycle 2</option></select></label>
      <div className="program-volume">
        <h2>Each training week</h2>
        <p>{(["squat", "bench", "deadlift"] as const).map(lift => <span key={lift}>{LIFT_LABELS[lift]} <strong>{totals[lift]} reps</strong></span>)}</p>
        <span className="muted small">6 lifting sessions · 171 prescribed working reps · rest between weeks</span>
      </div>
      <div className="calendar-list">
        {visible.map((session, i) => {
          const w = workoutForSession(session, workouts);
          const pending = session.adjustmentPending && !w;
          const next = (step.kind === "workout" || step.kind === "review") && step.session.id === session.id;
          const newWeek = i === 0 || visible[i - 1].weekId !== session.weekId;
          return (
            <div key={session.id}>
              {session.cycle === 2 && session.week === 1 && session.sessionNumber === 1 && cycle === "all" ? <section className="panel break-summary"><h2>Recovery week</h2><p>7 full days off after the final workout in Cycle 1. Cycle 2 waits until the break is complete.</p></section> : null}
              {newWeek ? <h2 className="calendar-phase">{session.cycle ? `Cycle ${session.cycle} · Week ${session.week}` : "Calibration"}</h2> : null}
              {newWeek && weekReviews.find(review => review.weekId === session.weekId) ? <p className="week-review-summary muted small">{(["squat", "bench", "deadlift"] as const).map(lift => {
                const review = weekReviews.find(review => review.weekId === session.weekId)!;
                const delta = WEEK_FEELING_ADJUSTMENTS[review.feelings[lift]];
                return `${LIFT_LABELS[lift]}: ${WEEK_FEELING_LABELS[review.feelings[lift]]} (${delta > 0 ? "+" : delta < 0 ? "−" : ""}${Math.abs(delta)} lb)`;
              }).join(" · ")}</p> : null}
              <button className={"calendar-day " + (next ? "current" : "")} data-session-id={session.id} onClick={() => onDay(session.id)}>
                <div className="day-date"><strong>{session.kind === "calibration" ? "Setup" : `Workout ${session.sessionNumber}`}</strong><span>{next ? "Up next" : w ? "Saved" : "In order"}</span></div>
                <div className="day-prescriptions">
                  {session.blocks.map(b => {
                    const saved = w?.targets.find(t => t.blockId === b.id);
                    const weight = saved ? saved.weight : pending ? null : calculateWorkingWeight(b, settings);
                    const unit = saved ? saved.unit : settings.unit;
                    return <div key={b.id}><strong>{LIFT_LABELS[b.lift]}</strong><span>{b.sets} × {b.reps} · {b.rpeTarget ? `RPE ${b.rpeTarget}` : `${weightText(weight)} ${unit}`}</span><small>{saved ? saved.rule : pending ? `${b.percent}% TM · check-in at week start` : formatRule(b)}</small></div>;
                  })}
                </div>
                <span className={"calendar-state " + (w?.status ?? "unstarted")}>{w?.status ?? (pending ? "Check-in first" : "Unstarted")}</span><Icon name="arrow" size={16} />
              </button>
            </div>
          );
        })}
      </div>
      <p className="muted small">Original confirmed training maxes stay in place. Weekly adjustments apply separately to each lift: easy +15, good +10, decent +5, OK 0, hard −5 lb. Saved targets and completed work stay as recorded.</p>
    </>
  );
}
