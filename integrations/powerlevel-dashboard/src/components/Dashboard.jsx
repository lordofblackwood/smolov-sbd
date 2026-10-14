import { Icon, RankEmblem } from "./Icons";
import { LIFTS, monday, shiftDate } from "../../public/shared/history.mjs";
export function weight(value, unit = "lb") {
  return value == null
    ? "—"
    : (unit === "kg" ? value / 2.2046226218 : value).toLocaleString(undefined, {
        maximumFractionDigits: 1,
      });
}
export function Meter({ value, color, label }) {
  return (
    <div
      className="meter"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <span
        style={{
          width: `${Math.max(0, Math.min(100, value))}%`,
          background: color,
        }}
      />
    </div>
  );
}
export function ConsistencyPanel({ data, today, onRank }) {
  const rank = (
    <button
      className={`${today ? "" : "panel "}consistency-panel`}
      onClick={onRank}
      aria-label="Explore consistency rank"
    >
      <RankEmblem color={data.ranked ? data.rank.color : "#66768e"} />
      <div className="consistency-content">
        <span className="eyebrow">Consistency rank</span>
        <h2 style={{ color: data.ranked ? data.rank.color : "var(--muted)" }}>
          {data.ranked ? `${data.rank.name} ${data.division}` : "Unranked"}
        </h2>
        <p>
          <strong>{data.ranked ? `${Math.round(data.score)}%` : "—"}</strong> of
          weekly targets
        </p>
        <Meter
          value={data.ranked ? data.progress : 0}
          color={data.rank.color}
          label="Progress to next rank"
        />
        <span className="small muted rank-link">
          View rank details <Icon name="arrow" size={13} />
        </span>
      </div>
    </button>
  );
  return today ? (
    <section
      className="panel consistency-with-calendar"
      aria-label="Consistency rank and calendar"
    >
      {rank}
      <Rhythm data={data} today={today} />
    </section>
  ) : (
    rank
  );
}
export function Rhythm({ data, today }) {
  const start = shiftDate(monday(today), -77);
  const columns = Array.from({ length: 12 }, (_, i) =>
    Array.from({ length: 7 }, (_, j) => shiftDate(start, i * 7 + j)),
  );
  return (
    <section className="rhythm" aria-labelledby="consistency-calendar-title">
      <div className="section-heading">
        <h2 id="consistency-calendar-title">Consistency calendar</h2>
        <span className="small muted">Last 12 weeks</span>
      </div>
      <div className="heat-months" aria-hidden="true">
        {columns.map((week, i) => (
          <span key={week[0]} style={{ gridColumn: i + 2 }}>
            {i === 0 || week[0].slice(0, 7) !== columns[i - 1][0].slice(0, 7)
              ? new Date(`${week[0]}T12:00:00`).toLocaleDateString(undefined, {
                  month: "short",
                })
              : ""}
          </span>
        ))}
      </div>
      <div className="heatmap">
        <div className="day-labels">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        {columns.map((week, i) => (
          <div className="heat-week" key={i}>
            {week.map((date) => (
              <span
                key={date}
                role="img"
                className={`heat-cell ${data.set.has(date) ? "trained" : ""} ${date > today ? "future" : ""} ${date === today ? "today" : ""}`}
                title={`${date}: ${date > today ? "upcoming" : data.set.has(date) ? "training day" : "rest / no record"}`}
                aria-label={`${date}: ${date > today ? "upcoming" : data.set.has(date) ? "training day" : "rest or no record"}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="rhythm-summary">
        <p>
          <strong>{data.thisWeek}</strong> / {data.target} days this week
        </p>
        <div className="heat-legend">
          <span>
            <i className="legend-trained" /> Trained
          </span>
          <span>
            <i className="legend-rest" /> No record
          </span>
          <span>
            <i className="legend-today" /> Today
          </span>
        </div>
      </div>
    </section>
  );
}
export function LiftRecords({ data, unit }) {
  return (
    <section className="current-lifts" aria-labelledby="current-lifts-title">
      <h2 id="current-lifts-title">Current PRs</h2>
      <dl className="current-lift-grid">
        {Object.entries(LIFTS).map(([id, name]) => (
          <div key={id}>
            <dt>{name.replace("Back ", "").replace(" Press", "")}</dt>
            <dd>
              {weight(data.records[id]?.weight, unit)} <span>{unit}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="small muted">Best recorded singles</p>
    </section>
  );
}
export function ActivityList({ events, unit, limit = 6 }) {
  if (!events.length)
    return (
      <p className="empty-copy">
        No sessions yet. Connect a tracker to see your training history.
      </p>
    );
  return (
    <div className="activity-list">
      {events.slice(0, limit).map((e) => (
        <article className="activity" key={e.id}>
          <span className={`result-icon ${e.success ? "success" : ""}`}>
            <Icon name={e.success ? "check" : "weight"} size={18} />
          </span>
          <div>
            <strong>{e.name}</strong>
            <span>
              {new Date(`${e.date}T12:00:00`).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}{" "}
              ·{" "}
              {e.source === "bulgarian"
                ? "Auto Bulgarian"
                : e.source === "smolov"
                  ? `Smolov SBD · ${e.kind === "warmup" ? "warm-up" : `${e.reps} actual reps`}`
                : e.source === "bodyweight"
                  ? `Away Strength · ${e.variant}`
                  : "Accessory Lifts"}
            </span>
          </div>
          <div className="activity-result">
            <strong>
              {e.source === "bodyweight"
                ? `${e.totalReps} reps`
                : e.weight != null
                  ? e.unit === "lb"
                    ? `${weight(e.weight, unit)} ${unit}`
                    : `${e.weight} ${e.unit}`
                  : e.weightLabel || "—"}
            </strong>
            <span>
              {e.outcome === "skipped"
                ? "Skipped"
                : e.outcome === "in-progress"
                  ? "In progress"
                  : e.success
                    ? "Completed"
                    : e.singleCompleted
                      ? "Single completed"
                      : "Attempt logged"}
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}
