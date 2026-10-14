export const weightText = (weight: number | null | undefined) =>
  weight == null
    ? "—"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
        weight,
      );
export const phaseShort = {
  calibration: "Calibration",
  "volume-1": "Volume 1",
  "volume-2": "Volume 2",
  peak: "Peak",
  taper: "Taper",
  meet: "Meet day",
};
export const phases = [
  { id: "calibration", label: "Calibration", date: "Oct 14–18" },
  { id: "volume-1", label: "Volume 1", date: "Oct 19–25" },
  { id: "volume-2", label: "Volume 2", date: "Oct 26–Nov 1" },
  { id: "peak", label: "Peak", date: "Nov 2–8" },
  { id: "taper", label: "Taper", date: "Nov 9–14" },
] as const;
