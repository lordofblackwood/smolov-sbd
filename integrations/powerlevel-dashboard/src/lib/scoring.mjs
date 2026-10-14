import { LIFTS, shiftDate, monday } from "../../public/shared/history.mjs";
import { compareStrength } from "./strength-comparison.mjs";
import { unrealizedPotential } from "./potential.mjs";
export const RANKS = [
  ["Iron", 0, "#a6a9b8"],
  ["Bronze", 15, "#c6947b"],
  ["Silver", 30, "#c5d0df"],
  ["Gold", 45, "#e9c875"],
  ["Platinum", 60, "#7fc9c9"],
  ["Emerald", 70, "#79dcb4"],
  ["Diamond", 85, "#c1a0ff"],
  ["Master", 95, "#dd98eb"],
  ["Grandmaster", 98, "#fa888e"],
  ["Challenger", 100, "#f7d78b"],
].map(([name, min, color], i) => ({ name, min, color, index: i }));
export function strength(events, profile = {}) {
  const records = Object.fromEntries(Object.keys(LIFTS).map((k) => [k, null]));
  for (const e of events)
    if (
      ["bulgarian", "smolov"].includes(e.source) &&
      e.singleCompleted &&
      e.exercise in records &&
      (records[e.exercise]?.weight ?? -1) < e.weight
    )
      records[e.exercise] = e;
  const known = Object.values(records).filter(Boolean);
  const total = known.reduce((s, e) => s + e.weight, 0);
  const complete = known.length === 3;
  const reference = compareStrength(records, profile);
  return {
    records,
    total,
    complete,
    known: known.length,
    comparisonProfile: profile,
    reference,
    progression: reference.progression,
    potential: unrealizedPotential(events, records, profile),
  };
}
export function consistency(events, today, target = 4) {
  const days = [
    ...new Set(
      events.filter((e) => e.countsDay && e.date <= today).map((e) => e.date),
    ),
  ].sort();
  const set = new Set(days);
  const week = monday(today);
  // Only completed calendar weeks affect rank; partial current weeks never punish rest days.
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const start = shiftDate(week, -7 * (12 - i));
    const count = Array.from({ length: 7 }, (_, j) =>
      shiftDate(start, j),
    ).filter((d) => set.has(d)).length;
    return { start, count, credit: Math.min(count, target) / target };
  });
  const score = (weeks.reduce((n, w) => n + w.credit, 0) / 12) * 100;
  const rank = RANKS.filter((r) => r.min <= score + 1e-8).at(-1);
  const next = RANKS[rank.index + 1];
  const progress = next
    ? Math.max(
        0,
        Math.min(100, ((score - rank.min) / (next.min - rank.min)) * 100),
      )
    : 100;
  const division =
    rank.index < 7
      ? ["IV", "III", "II", "I"][Math.min(3, Math.floor(progress / 25))]
      : "";
  const lp =
    rank.index < 7
      ? Math.min(99, Math.floor((progress % 25) * 4))
      : Math.floor(progress);
  let streak = 0;
  for (const w of [...weeks].reverse()) {
    if (w.count < target) break;
    streak++;
  }
  const thisWeek = days.filter((d) => d >= week && d <= today).length;
  return {
    days,
    set,
    weeks,
    score,
    rank,
    next,
    division,
    lp,
    progress,
    streak,
    thisWeek,
    target,
    totalDays: days.length,
    ranked: days.length > 0,
  };
}
export function dashboard(snapshots, today, target = 4, profile = {}) {
  const all = Object.values(snapshots).flatMap((s) => s?.events || []);
  const future = all.filter((e) => e.date > today).length;
  const events = all
    .filter((e) => e.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const accessories = new Map();
  const bodyweight = new Map();
  for (const e of events)
    if (e.source === "bodyweight" && e.success) {
      const key = `${e.exercise}:${e.variant}`;
      if (!bodyweight.has(key) || e.totalReps > bodyweight.get(key).totalReps)
        bodyweight.set(key, e);
    }
  for (const e of [...events].reverse())
    if (e.source === "accessory" && e.success) {
      const key = `${e.exercise}:${e.unit}`;
      const previous = accessories.get(key);
      if (
        !previous ||
        e.weight > previous.weight ||
        (e.weight === previous.weight &&
          (e.sets || 0) * (e.reps || 0) >
            (previous.sets || 0) * (previous.reps || 0))
      )
        accessories.set(key, e);
    }
  return {
    events,
    future,
    strength: strength(events, profile),
    consistency: consistency(events, today, target),
    accessories: [...accessories.values()],
    bodyweight: [...bodyweight.values()],
  };
}
