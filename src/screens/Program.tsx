import { useState } from "react";
import type { Settings, Workout } from "../domain/types";
import {
  PROGRAM_DAYS,
  programDaysForWorkouts,
  getProgramDay,
  PHASE_LABELS,
  LIFT_LABELS,
  calculateWorkingWeight,
  formatDate,
  formatRule,
  prescribedReps,
  todayDate,
} from "../domain/program";
import { weightText } from "../ui";
import { Icon } from "../components/Icon";
export function Program({
  settings,
  workouts,
  onDay,
}: {
  settings: Settings;
  workouts: Workout[];
  onDay: (date: string) => void;
}) {
  const [phase, setPhase] = useState<string>("all");
  const programDays = programDaysForWorkouts(workouts);
  const preservedWeeks = (["volume-1", "volume-2"] as const).filter((week) =>
    programDays.some(
      (day) =>
        day.phase === week &&
        JSON.stringify(day.blocks) !==
          JSON.stringify(
            PROGRAM_DAYS.find((item) => item.date === day.date)?.blocks,
          ),
    ),
  );
  const visible = programDays.filter(
    (d) => phase === "all" || d.phase === phase,
  );
  return (
    <>
      <h1>Your program</h1>
      <p className="subtitle">Modified Smolov Jr. — SBD Meet Prep</p>
      <div className="section-heading program-meta">
        <span>Oct 14 – Nov 15, 2026</span>
        <span className="muted">America/New_York</span>
      </div>
      {preservedWeeks.map((week) => (
        <p className="app-alert" role="status" key={week}>
          Unstarted days in {PHASE_LABELS[week].toLowerCase()} keep their original
          pairings because the week contains saved workouts from that layout.
          Saved days keep their own targets.
        </p>
      ))}
      <label className="filter-label">
        Phase
        <select value={phase} onChange={(e) => setPhase(e.target.value)}>
          <option value="all">All phases</option>
          {Object.entries(PHASE_LABELS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {["all", "volume-1", "volume-2"].includes(phase) && (
        <div className="program-volume">
          <h2>Each volume week</h2>
          <p>
            {Object.entries(
              prescribedReps(programDays.filter((d) => d.phase === "volume-1")),
            )
              .filter(([l]) => l !== "combined")
              .map(([l, n]) => (
                <span key={l}>
                  {LIFT_LABELS[l as keyof typeof LIFT_LABELS]}{" "}
                  <strong>{n} reps</strong>
                </span>
              ))}
          </p>
          <span className="muted small">
            6 lifting days · 171 prescribed working reps
          </span>
        </div>
      )}
      <div className="calendar-list">
        {visible.map((planned, i) => {
          const w = workouts.find((w) => w.date === planned.date);
          const d = w ? (getProgramDay(w.date, workouts) ?? planned) : planned;
          return (
            <div key={d.date}>
              {(i === 0 || d.phase !== visible[i - 1].phase) && (
                <h2 className="calendar-phase">{PHASE_LABELS[d.phase]}</h2>
              )}
              <button
                className={
                  "calendar-day " + (d.date === todayDate() ? "current" : "")
                }
                onClick={() => onDay(d.date)}
              >
                <div className="day-date">
                  <strong>{formatDate(d.date, { weekday: "short" })}</strong>
                  <span>
                    {formatDate(d.date, { month: "short", day: "numeric" })}
                  </span>
                </div>
                <div className="day-prescriptions">
                  {d.blocks.length ? (
                    d.blocks.map((b) => {
                      const saved = w?.targets.find(
                        (target) => target.blockId === b.id,
                      );
                      const weight = saved
                        ? saved.weight
                        : calculateWorkingWeight(b, settings);
                      const unit = saved ? saved.unit : settings.unit;
                      const rpeTarget = saved ? saved.rpeTarget : b.rpeTarget;
                      return (
                        <div key={b.id}>
                          <strong>{LIFT_LABELS[b.lift]}</strong>
                          <span>
                            {b.sets} × {b.reps} ·{" "}
                            {rpeTarget
                              ? `RPE ${rpeTarget}`
                              : `${weightText(weight)} ${unit}`}
                          </span>
                          <small>{saved ? saved.rule : formatRule(b)}</small>
                        </div>
                      );
                    })
                  ) : (
                    <span>
                      {d.phase === "meet"
                        ? "3 attempts per lift"
                        : (d.optionalAccessories ?? d.recovery)}
                    </span>
                  )}
                </div>
                <span
                  className={"calendar-state " + (w?.status ?? "unstarted")}
                >
                  {w?.status ??
                    (d.blocks.length
                      ? "Unstarted"
                      : d.phase === "meet"
                        ? "Meet"
                        : "Recovery")}
                </span>
                <Icon name="arrow" size={16} />
              </button>
            </div>
          );
        })}
      </div>
      <p className="muted small">
        Targets stay anchored to the original confirmed training maxes. Missed
        sessions stay on their scheduled date.
      </p>
    </>
  );
}
