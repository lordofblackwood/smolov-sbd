import { useState, type ChangeEvent } from "react";
import type {
  Settings as SettingsType,
  TrainingMax,
  Unit,
  Lift,
  Workout,
} from "../domain/types";
import {
  LIFTS,
  LIFT_LABELS,
  programDaysForWorkouts,
  calculateWorkingWeight,
  previewTrainingMaxChange,
  convertWeight,
  todayDate,
} from "../domain/program";
import type { AppState } from "../storage/types";
import { exportBackup, backupFilename, importBackup } from "../storage/backup";
import { Modal } from "../components/Modal";
import { Icon } from "../components/Icon";
import { weightText } from "../ui";
export function TmReview({
  lift,
  initial,
  settings,
  workouts,
  onClose,
  onSave,
}: {
  lift: Lift;
  initial?: TrainingMax;
  settings: SettingsType;
  workouts: Workout[];
  onClose: () => void;
  onSave: (next: TrainingMax) => void;
}) {
  const existing = initial ?? settings.trainingMaxes[lift];
  const [weight, setWeight] = useState(existing ? String(existing.weight) : "");
  const [unit, setUnit] = useState<Unit>(existing?.unit ?? settings.unit);
  const [rpe, setRpe] = useState(
    existing?.calibrationRpe === undefined
      ? ""
      : String(existing.calibrationRpe),
  );
  const [confirmed, setConfirmed] = useState(Boolean(initial));
  const [error, setError] = useState("");
  const next: TrainingMax = {
    weight: Number(weight),
    unit,
    calibrationRpe: Number(rpe),
    confirmedAt: new Date().toISOString(),
  };
  const valid =
    weight !== "" &&
    Number(weight) > 0 &&
    Number.isFinite(Number(weight)) &&
    rpe !== "" &&
    Number(rpe) >= 6 &&
    Number(rpe) <= 8;
  const changes = valid
    ? previewTrainingMaxChange(lift, next, settings, workouts, todayDate())
    : [];
  return (
    <Modal title={`${LIFT_LABELS[lift]} training max`} onClose={onClose}>
      <p>
        Enter the actual weight of your successful RPE 6–8 calibration single. A
        previously performed result is welcome.
      </p>
      <div className="tm-inputs">
        <label>
          Calibration weight
          <input
            type="number"
            aria-label={`${LIFT_LABELS[lift]} calibration weight`}
            inputMode="decimal"
            min="0"
            step="any"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
        </label>
        <label>
          Unit
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value as Unit)}
          >
            <option>lb</option>
            <option>kg</option>
          </select>
        </label>
        <label>
          Calibration RPE
          <input
            type="number"
            inputMode="decimal"
            aria-label={`${LIFT_LABELS[lift]} calibration RPE`}
            min="6"
            max="8"
            step="0.5"
            value={rpe}
            onChange={(e) => setRpe(e.target.value)}
          />
        </label>
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />{" "}
        This is my actual successful calibration single.
      </label>
      <div className="tm-preview">
        <h3>Future target preview</h3>
        {valid ? (
          <>
            <p className="small muted">
              {changes.length} future prescriptions will change. Historical and
              in-progress targets stay as saved.
            </p>
            <div className="preview-list">
              {changes.map((c) => (
                <div key={c.blockId}>
                  <span>
                    {c.date.slice(5)} · {c.rule}
                  </span>
                  <strong>
                    {weightText(c.before)} → {weightText(c.after)} {c.unit}
                  </strong>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="small muted">
            Enter a positive weight and RPE 6–8 to preview.
          </p>
        )}
      </div>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      <button
        className="primary"
        onClick={() => {
          if (!valid || !confirmed) {
            setError(
              "Confirm your actual successful single and its achieved RPE 6–8.",
            );
            return;
          }
          onSave(next);
        }}
      >
        Confirm training max <Icon name="check" />
      </button>
    </Modal>
  );
}
export function Settings({
  state,
  accountId,
  paired,
  onSettings,
  onState,
  onPair,
  onDisconnect,
  onCheck,
  onRetry,
  connectionStatus,
  syncStatus,
  onTm,
}: {
  state: AppState;
  accountId: string;
  paired: boolean;
  onSettings: (settings: SettingsType) => void;
  onState: (state: AppState) => Promise<void>;
  onPair: (code: string, adopt: boolean) => Promise<void>;
  onDisconnect: () => Promise<void>;
  onCheck: () => Promise<void>;
  onRetry: () => void;
  connectionStatus: string;
  syncStatus: string;
  onTm: (lift: Lift) => void;
}) {
  const { settings } = state;
  const [code, setCode] = useState("");
  const [adopt, setAdopt] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [restore, setRestore] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pendingImport, setPendingImport] = useState<{
    state: AppState;
    message: string;
  } | null>(null);
  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    try {
      const f = e.target.files?.[0];
      if (!f) return;
      if (f.size > 5 * 1024 * 1024)
        throw Error("Choose a JSON backup no larger than 5 MB.");
      const result = importBackup(await f.text(), state, accountId, {
        restorePreferences: restore,
      });
      const message = `Imported ${result.report.addedWorkouts} workouts; ${result.report.duplicateWorkouts} duplicates skipped; ${result.report.conflictingWorkoutIds.length} conflicts kept unchanged.${result.report.settingsImported ? " Preferences restored." : ""}`;
      if (restore) {
        setPendingImport({ state: result.state, message });
      } else {
        await onState(result.state);
        setMessage(message);
      }
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
    e.target.value = "";
  };
  const download = () => {
    try {
      const url = URL.createObjectURL(
        new Blob([exportBackup(state, accountId)], {
          type: "application/json",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = backupFilename();
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("Backup exported. Keep it somewhere safe.");
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <>
      <h1>Settings</h1>
      <p className="subtitle">Your training. Your original maxes.</p>
      <section className="panel settings-section">
        <h2>Training maxes</h2>
        <p className="muted small">
          Actual calibration singles. All percentages stay anchored here.
        </p>
        {LIFTS.map((l) => {
          const tm = settings.trainingMaxes[l];
          return (
            <button key={l} className="tm-row" onClick={() => onTm(l)}>
              <span>{LIFT_LABELS[l]}</span>
              <strong>
                {tm
                  ? `${weightText(convertWeight(tm.weight, tm.unit, settings.unit))} ${settings.unit}`
                  : "Confirm TM"}
              </strong>
              <Icon name="arrow" size={18} />
            </button>
          );
        })}
        <p className="small muted">
          Peak singles never increase your training max automatically.
        </p>
      </section>
      <section className="panel settings-section">
        <h2>Weights & timer</h2>
        <div className="form-grid">
          <label>
            Training display unit
            <select
              value={settings.unit}
              onChange={(e) =>
                onSettings({
                  ...settings,
                  unit: e.target.value as Unit,
                  increment: e.target.value === "lb" ? 5 : 2.5,
                })
              }
            >
              <option value="lb">Pounds (lb)</option>
              <option value="kg">Kilograms (kg)</option>
            </select>
          </label>
          <label>
            Calculation increment ({settings.unit})
            <input
              type="number"
              min="0.01"
              step="any"
              value={settings.increment}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (n > 0 && n <= 100)
                  onSettings({ ...settings, increment: n });
              }}
            />
          </label>
          <label>
            Rest timer (seconds)
            <input
              type="number"
              min="1"
              max="3600"
              value={settings.restSeconds}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n > 0 && n <= 3600)
                  onSettings({ ...settings, restSeconds: n });
              }}
            />
          </label>
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            checked={settings.autoRest}
            onChange={(e) =>
              onSettings({ ...settings, autoRest: e.target.checked })
            }
          />{" "}
          Start rest timer after completing a set
        </label>
        <p className="muted small">
          {settings.unit === "lb" ? (
            <>
              Pound targets round up to totals loadable with a 45 lb bar and
              5 lb plates: 265, 275, 285 lb. For example, 270 becomes 275 lb.
              Week 2’s +5 lb for squat and bench is applied before this final
              plate rounding. Saved workout targets stay unchanged.
            </>
          ) : (
            <>
              Exact halfway weights round upward. Week 2 adds 5 lb after Week 1
              rounding for squat and bench.
            </>
          )}
        </p>
      </section>
      <section className="panel settings-section">
        <div className="section-heading">
          <h2>Powerlevel connection</h2>
          <Icon name="link" />
        </div>
        <p className="muted small">
          Use your existing Powerlevel connection code. No new account is
          created.
        </p>
        <p className="connection-status" role="status">
          {connectionStatus}
        </p>
        {syncStatus ? <p className="connection-status" role="status">{syncStatus}</p> : null}
        {paired ? (
          <>
            <p className="small muted">
              Account {accountId.slice(0, 12)}… · Workouts and pending uploads
              stay scoped to this connection.
            </p>
            <div className="button-grid">
              <button className="secondary" onClick={() => void onCheck()}>
                Check connection
              </button>
              <button className="secondary" onClick={onRetry}>
                Retry sync
              </button>
            </div>
            <p className="small muted">
              Retry sync checks your finished workouts and restores any missing
              from Powerlevel.
            </p>
            <button className="text-button" onClick={() => void onDisconnect()}>
              Disconnect · keep account data locally
            </button>
          </>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setPairing(true);
              try {
                await onPair(code, adopt);
                setCode("");
                setError("");
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setPairing(false);
              }
            }}
          >
            <label>
              Existing connection code
              <input
                aria-label="Powerlevel connection code"
                type="password"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="pl1_…"
                autoComplete="off"
                required
              />
            </label>
            {state.workouts.length > 0 ? (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={adopt}
                  onChange={(e) => setAdopt(e.target.checked)}
                />{" "}
                Include my unsynced local workouts in this account
              </label>
            ) : null}
            <button className="secondary full" type="submit" disabled={pairing}>
              {pairing ? "Pairing…" : "Pair existing account"}
            </button>
          </form>
        )}
        <p className="small muted">
          Uploads use the relay’s dedicated Smolov source after its supported
          contract is verified. Bulgarian history stays separate.
        </p>
        <p className="small muted">
          Uses the existing backSquat, benchPress, and generic deadlift
          identifiers. Variant details stay in your notes.
        </p>
      </section>
      <section className="panel settings-section">
        <h2>Local data</h2>
        <p className="muted small">
          JSON backups include targets, actual sets, meet attempts and pending
          uploads. They exclude connection codes.
        </p>
        <button className="secondary full" onClick={download}>
          <Icon name="download" /> Export JSON backup
        </button>
        <label className="import-label">
          Import JSON backup
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => void importFile(e)}
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={restore}
            onChange={(e) => setRestore(e.target.checked)}
          />{" "}
          Also restore training maxes, units and timer preferences
        </label>
        <p className="muted small">
          Matching IDs are skipped. Conflicts preserve the local record. Backups
          from another account are rejected.
        </p>
      </section>
      {message ? (
        <p className="success" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {pendingImport ? (
        <Modal
          title="Review backup preferences"
          onClose={() => setPendingImport(null)}
        >
          <p>
            Future unstarted prescriptions will use the imported training maxes
            and loading preferences. Saved and in-progress target snapshots stay
            as recorded.
          </p>
          <div className="preview-list">
            {programDaysForWorkouts(state.workouts)
              .filter(
                (d) =>
                  d.date >= todayDate() &&
                  !state.workouts.some((w) => w.date === d.date),
              )
              .flatMap((d) =>
                d.blocks
                  .filter((b) => b.percent !== undefined)
                  .map((b) => {
                    const before = calculateWorkingWeight(b, settings);
                    const after = calculateWorkingWeight(
                      b,
                      pendingImport.state.settings,
                    );
                    return before === after &&
                      settings.unit ===
                        pendingImport.state.settings.unit ? null : (
                      <div key={b.id}>
                        <span>
                          {d.date.slice(5)} · {LIFT_LABELS[b.lift]}
                        </span>
                        <strong>
                          {weightText(before)} {settings.unit} →{" "}
                          {weightText(after)}{" "}
                          {pendingImport.state.settings.unit}
                        </strong>
                      </div>
                    );
                  }),
              )}
          </div>
          <button
            className="primary"
            onClick={() =>
              void onState(pendingImport.state)
                .then(() => {
                  setMessage(pendingImport.message);
                  setPendingImport(null);
                })
                .catch((e) => setError((e as Error).message))
            }
          >
            Import & restore preferences
          </button>
        </Modal>
      ) : null}
      <p className="small muted">
        Smolov SBD v1 · Meet date fixed to November 15, 2026 · Local-first
        storage
      </p>
    </>
  );
}
