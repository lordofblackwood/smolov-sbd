export const weightText = (weight: number | null | undefined) =>
  weight == null
    ? "—"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
        weight,
      );
