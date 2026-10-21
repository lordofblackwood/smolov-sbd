import { useState } from "react";
import type { Lift, Settings, WeekFeeling, WeekReview } from "../domain/types";
import { calculateWorkingWeight, LIFTS, LIFT_LABELS } from "../domain/program";
import { createWeekReview, WEEK_FEELING_ADJUSTMENTS, type TrainingSession } from "../domain/sequence";
import { weightText } from "../ui";
import { Icon } from "./Icon";

const labels: Record<WeekFeeling, string> = { easy: "Easy · +15 lb", good: "Good · +10 lb", decent: "Decent · +5 lb", ok: "OK · no change", hard: "Hard · −5 lb" };
const offsetText = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value)} lb`;

export function WeekCheckIn({ weekId, session, previousOffsetsLb, sessions, settings, onConfirm, onProgram }: {
  weekId: string;
  session: TrainingSession;
  previousOffsetsLb: Record<Lift, number>;
  sessions: readonly TrainingSession[];
  settings: Settings;
  onConfirm: (review: WeekReview) => void;
  onProgram: () => void;
}) {
  const [feelings, setFeelings] = useState<Partial<Record<Lift, WeekFeeling>>>({});
  const [error, setError] = useState("");
  const hasAllFeelings = LIFTS.every(lift => Boolean(feelings[lift]));
  const invalidLifts = hasAllFeelings ? LIFTS.filter(lift => sessions
    .filter(s => s.weekId === weekId).flatMap(s => s.blocks)
    .filter(b => b.lift === lift && b.percent !== undefined)
    .some(b => {
      const weight = calculateWorkingWeight({ ...b, offsetLb: previousOffsetsLb[lift] + WEEK_FEELING_ADJUSTMENTS[feelings[lift]!] }, settings);
      return weight !== null && weight <= 0;
    })) : [];
  const ready = hasAllFeelings && !invalidLifts.length;
  return (
    <>
      <section className="training-heading"><div><h1>How did last week feel?</h1><span className="phase-tag volume-1">Cycle {session.cycle} · Week {session.week}</span></div></section>
      <p className="subtitle">Choose for each lift before starting the new week.</p>
      <section className="panel week-check-in">
        {LIFTS.map(lift => {
          const feeling = feelings[lift];
          const beforeOffset = previousOffsetsLb[lift];
          const afterOffset = beforeOffset + (feeling ? WEEK_FEELING_ADJUSTMENTS[feeling] : 0);
          const firstBlock = sessions.filter(s => s.weekId === weekId).flatMap(s => s.blocks).find(b => b.lift === lift && b.percent !== undefined);
          const before = firstBlock ? calculateWorkingWeight({ ...firstBlock, offsetLb: beforeOffset }, settings) : null;
          const after = firstBlock ? calculateWorkingWeight({ ...firstBlock, offsetLb: afterOffset }, settings) : null;
          return (
            <div className="week-lift" key={lift}>
              <label>{LIFT_LABELS[lift]} last week<select value={feeling ?? ""} onChange={e => setFeelings(current => ({ ...current, [lift]: e.target.value as WeekFeeling }))}>
                <option value="" disabled>Choose how it felt</option>
                {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>
              <div className="week-adjustment" aria-live="polite"><span>Weekly offset</span><strong>{offsetText(beforeOffset)} → {feeling ? offsetText(afterOffset) : "Choose above"}</strong></div>
              {firstBlock && feeling ? <p className="muted small">First {LIFT_LABELS[lift].toLowerCase()} prescription ({firstBlock.percent}% TM): {weightText(before)} → {weightText(after)} {settings.unit}</p> : null}
            </div>
          );
        })}
        <p className="muted small preview-note">Adjustments are in pounds, accumulate from the previous week, and apply before your usual plate rounding. Kilogram targets use the converted adjustment. Your confirmed training maxes stay in place.</p>
        {invalidLifts.length ? <p className="error" role="alert">This adjustment leaves no positive {invalidLifts.map(lift => LIFT_LABELS[lift].toLowerCase()).join(" or ")} target. Choose a smaller reduction or review your training max in Settings.</p> : null}
        {settings.unit === "lb" ? <p className="muted small preview-note">Pound targets have a 45 lb empty-bar minimum.</p> : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
        <button className="primary full" disabled={!ready} onClick={() => {
          if (!ready) { setError("Choose how each lift felt."); return; }
          try { onConfirm(createWeekReview(weekId, feelings as Record<Lift, WeekFeeling>, previousOffsetsLb)); } catch (e) { setError((e as Error).message); }
        }}>Confirm week adjustments <Icon name="arrow" /></button>
      </section>
      <button className="text-button" onClick={onProgram}>View full program</button>
    </>
  );
}
