import { useState, useEffect, useRef } from "react";
import { Icon } from "./Icons";
import { newCode } from "../../public/shared/sync.mjs";
const sources = [
  [
    "bulgarian",
    "Auto Bulgarian",
    "Squat, bench press & deadlift",
    "https://lordofblackwood.github.io/bulgarian-powerlifter-tracker/",
  ],
  [
    "accessory",
    "Accessory Lifts",
    "Accessories & completed sessions",
    "https://lordofblackwood.github.io/workout-tool/",
  ],
  [
    "bodyweight",
    "Away Strength",
    "Air squats, push-ups & glute bridges",
    "https://lordofblackwood.github.io/away-strength/",
  ],
  [
    "smolov",
    "Smolov SBD",
    "Actual squat, bench & deadlift sets and meet preparation",
    "https://lordofblackwood.github.io/smolov-sbd/",
  ],
];
export function Connect({ store, onDemo, install }) {
  const [input, setInput] = useState("");
  const [message, setMessage] = useState("");
  const [show, setShow] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const dialog = useRef(null);
  useEffect(() => {
    if (confirm) dialog.current?.showModal();
  }, [confirm]);
  function connect(code) {
    try {
      store.pair(code);
      setInput("");
      setMessage(
        "Connection saved. Pair each installed tracker once using this code.",
      );
    } catch (e) {
      setMessage(e.message);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(store.code);
      setMessage(
        "Copied. Paste this code in each installed tracker’s Powerlevel dashboard sync section.",
      );
    } catch {
      setShow(true);
      setMessage("Select and copy the connection code below.");
    }
  }
  return (
    <>
      <div className="page-heading">
        <h1>Your apps. Connected.</h1>
        <p>A one-time setup. Automatic updates from then on.</p>
      </div>
      <section className="panel pairing">
        <div className="section-heading">
          <h2>
            {store.code ? "YOUR PRIVATE CONNECTION" : "CONNECT YOUR TRACKERS"}
          </h2>
          <Icon name="lock" size={20} />
        </div>
        {store.code ? (
          <>
            <p>
              Use this same code in each workout app on your iPhone. Keep it
              private: it unlocks your encrypted history.
            </p>
            <div className="code-row">
              <input
                aria-label="Your private connection code"
                type={show ? "text" : "password"}
                readOnly
                value={store.code}
              />
              <button
                className="icon-button"
                onClick={copy}
                aria-label="Copy connection code"
              >
                <Icon name="copy" />
              </button>
            </div>
            <button className="text-button" onClick={() => setShow(!show)}>
              {show ? "Hide code" : "Show code"}
            </button>
          </>
        ) : (
          <>
            <p>
              Create a private connection, then paste its code into the
              Powerlevel dashboard sync section of each installed workout app.
            </p>
            <button
              className="primary-button"
              onClick={() => connect(newCode())}
            >
              Create connection <Icon name="arrow" size={18} />
            </button>
            <details className="existing-connection">
              <summary>Already have a connection code?</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  connect(input);
                }}
              >
                <label htmlFor="pair-code">Connection code</label>
                <input
                  id="pair-code"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  type="password"
                  placeholder="pl1_…"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck="false"
                  required
                />
                <button className="secondary-button" type="submit">
                  Connect this dashboard
                </button>
              </form>
            </details>
          </>
        )}
        {message ? (
          <p role="status" className="connection-message">
            {message}
          </p>
        ) : null}
      </section>
      <div className="source-list">
        {sources.map(([id, name, description, url]) => {
          const status = store.sourceStatus[id];
          const count = store.snapshots[id]?.events.length;
          const connected = ["cloud", "device"].includes(status?.mode);
          return (
            <section className="panel source" key={id}>
              <div className="source-top">
                <span className="source-icon">
                  <Icon name="weight" />
                </span>
                <div>
                  <h2>{name}</h2>
                  <p>{description}</p>
                </div>
                <span
                  className={`status-dot ${connected ? "connected" : ""}`}
                  aria-label={connected ? "Connected" : "Waiting"}
                />
              </div>
              <div className="source-details">
                <strong>
                  {connected
                    ? `${count ?? 0} records connected`
                    : status?.mode === "offline"
                      ? "Offline · cached history"
                      : store.code
                        ? "Waiting for tracker"
                        : "Not connected"}
                </strong>
                <span>
                  {status?.updatedAt
                    ? `Tracker last synced ${new Date(status.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                    : "Open the installed tracker and enter your code once."}
                </span>
              </div>
              <a
                className="text-link"
                href={url}
                target="_blank"
                rel="noreferrer"
              >
                Open tracker website <Icon name="arrow" size={16} />
              </a>
            </section>
          );
        })}
      </div>
      <section className="panel explanation">
        <h2>Set up once on your iPhone</h2>
        <ol>
          <li>
            Install this dashboard: in Safari, tap Share, then Add to Home
            Screen. Open the installed dashboard before creating your
            connection.
          </li>
          <li>Copy your connection code above.</li>
          <li>
            Open your existing Auto Bulgarian home-screen app. Accept its update
            if offered. Scroll to <strong>Powerlevel dashboard sync</strong>,
            paste the code and tap <strong>Connect dashboard</strong>.
          </li>
          <li>Repeat in your existing Accessory Lifts home-screen app.</li>
          <li>For bodyweight workouts, install Away Strength from its link above. In its Sync tab, paste the same code and tap <strong>Connect dashboard</strong>.</li>
          <li>For Smolov SBD, use the same code in Settings. Its independent source keeps Auto Bulgarian history intact.</li>
        </ol>
        <p>
          Keep logging in your original apps. After each change, the open
          tracker syncs automatically. Powerlevel refreshes on launch, when you
          return to it, and every minute while open.
        </p>
        <p className="small muted">
          iOS pauses closed apps. Offline changes sync the next time the tracker
          is open with internet. If an update is missing, reopen the tracker;
          keep it installed so its local history stays available.
        </p>
      </section>
      <section className="panel explanation">
        <h2>Private by design</h2>
        <p>
          Your phone encrypts history before it leaves the tracker. The sync
          service stores encrypted snapshots; your connection code stays on your
          devices. The dashboard keeps a local copy for offline viewing.
        </p>
        <p>
          Lost the code? Copy it from a connected dashboard. Use one
          installation of each tracker per code to avoid older devices replacing
          newer history.
        </p>
      </section>
      <div className="connection-actions">
        <button
          className="secondary-button"
          onClick={store.refresh}
          disabled={store.busy}
        >
          <Icon name="sync" size={18} />
          {store.busy ? "Refreshing…" : "Refresh histories"}
        </button>
        <button className="text-button" onClick={onDemo}>
          Explore a demo
        </button>
        {install ? (
          <button className="text-button" onClick={install}>
            Install Powerlevel
          </button>
        ) : null}
        {store.code ? (
          <button
            className="text-button muted"
            onClick={() => setConfirm(true)}
          >
            Disconnect this dashboard
          </button>
        ) : null}
      </div>
      {confirm ? (
        <dialog
          ref={dialog}
          aria-labelledby="disconnect-title"
          className="modal panel"
          onCancel={() => setConfirm(false)}
        >
          <section>
            <h2 id="disconnect-title">Disconnect this dashboard?</h2>
            <p>
              Its cached history and connection code will be removed. Your
              trackers and their original workout histories stay intact. Save
              your code first if you want to reconnect.
            </p>
            <div className="button-row">
              <button
                className="secondary-button"
                autoFocus
                onClick={() => setConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  store.disconnect();
                  setConfirm(false);
                }}
              >
                Disconnect
              </button>
            </div>
          </section>
        </dialog>
      ) : null}
    </>
  );
}
