import { useEffect, useState } from "react";
import { Icon } from "./Icon";
export function RestTimer({
  end,
  seconds,
  onChange,
}: {
  end: number | null;
  seconds: number;
  onChange: (end: number | null) => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const left = end ? Math.max(0, Math.ceil((end - now) / 1000)) : seconds;
  return (
    <section className="panel timer">
      <div className="section-heading">
        <span>
          <Icon name="clock" /> Rest timer
        </span>
        <span className="muted small">
          {end && left === 0 ? "Rest finished" : end ? "Running" : "Ready"}
        </span>
      </div>
      <strong
        className="timer-value"
        role="timer"
        aria-label={`${Math.floor(left / 60)} minutes ${left % 60} seconds`}
      >
        {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
      </strong>
      <div className="timer-controls">
        <button
          className="primary"
          onClick={() => {
            setNow(Date.now());
            onChange(Date.now() + seconds * 1000);
          }}
        >
          Start
        </button>
        <button
          className="secondary"
          onClick={() =>
            onChange(
              Math.max(end ?? Date.now() + seconds * 1000, Date.now()) + 30000,
            )
          }
        >
          +30s
        </button>
        <button className="secondary" onClick={() => onChange(null)}>
          Reset
        </button>
      </div>
    </section>
  );
}
