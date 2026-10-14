import { useState } from "react";
import { ActivityList, weight } from "./Dashboard";
export function History({ data, unit, onUnit }) {
  const [source, setSource] = useState("all");
  const [limit, setLimit] = useState(30);
  const events = data.events.filter(
    (e) => source === "all" || e.source === source,
  );
  return (
    <>
      <div className="page-heading">
        <h1>Your training story.</h1>
        <p>
          {data.consistency.totalDays} training{" "}
          {data.consistency.totalDays === 1 ? "day" : "days"}. Every effort
          accounted for.
        </p>
      </div>
      <div className="history-controls">
        <div className="filter-rail">
          {[
            ["all", "All training"],
            ["bulgarian", "Main lifts"],
            ["smolov", "Smolov SBD"],
            ["accessory", "Accessories"],
            ["bodyweight", "Bodyweight"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={source === id ? "active" : ""}
              onClick={() => {
                setSource(id);
                setLimit(30);
              }}
              aria-pressed={source === id}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="unit-label">
          Units
          <select
            aria-label="Display weight units"
            value={unit}
            onChange={(e) => onUnit(e.target.value)}
          >
            <option value="lb">lb</option>
            <option value="kg">kg</option>
          </select>
        </label>
      </div>
      <section className="panel history-panel">
        <ActivityList events={events} unit={unit} limit={limit} />
        {events.length > limit ? (
          <button className="text-button" onClick={() => setLimit(limit + 30)}>
            Show 30 more
          </button>
        ) : null}
      </section>
      {data.bodyweight.length > 0 ? (
        <section className="panel accessories">
          <div className="section-heading">
            <h2>BODYWEIGHT BEST SESSIONS</h2>
          </div>
          {data.bodyweight.map((e) => (
            <div className="accessory-row" key={`${e.exercise}:${e.variant}`}>
              <span>
                {e.name}
                <small> · {e.variant}</small>
              </span>
              <strong>
                {e.totalReps} reps<small> · {e.actualReps.join(" + ")}</small>
              </strong>
            </div>
          ))}
          <p className="small muted">
            Most completed reps in one session per variation. Bodyweight work
            contributes to consistency and stays separate from your barbell
            strength total.
          </p>
        </section>
      ) : null}
      {data.accessories.length > 0 ? (
        <section className="panel accessories">
          <div className="section-heading">
            <h2>ACCESSORY PERSONAL BESTS</h2>
          </div>
          {data.accessories.map((e) => (
            <div className="accessory-row" key={`${e.exercise}:${e.unit}`}>
              <span>{e.name}</span>
              <strong>
                {e.unit === "lb"
                  ? `${weight(e.weight, unit)} ${unit}`
                  : e.weight != null
                    ? `${e.weight} ${e.unit}`
                    : e.weightLabel}
                {e.sets && e.reps ? (
                  <small>
                    {" "}
                    · {e.sets} × {e.reps}
                  </small>
                ) : null}
              </strong>
            </div>
          ))}
          <p className="small muted">
            Accessories contribute to consistency. Machine, dumbbell and timed
            records remain separate from the three-lift strength total.
          </p>
        </section>
      ) : null}
    </>
  );
}
