// Display + numeric formatting helpers (UGX, dates, etc.)

export const UGX = "UGX";

export function formatUGX(value: number | undefined | null, opts?: { compact?: boolean }): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  if (opts?.compact && Math.abs(value) >= 1_000_000) {
    return `${UGX} ${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  if (opts?.compact && Math.abs(value) >= 1_000) {
    return `${UGX} ${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}K`;
  }
  return `${UGX} ${new Intl.NumberFormat("en-UG", { maximumFractionDigits: 0 }).format(value)}`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-UG").format(value);
}

export function formatDate(value: string | Date | undefined | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

export function formatDateTime(value: string | Date | undefined | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function formatMonth(month: string): string {
  // "YYYY-MM" -> "Mon YYYY"
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return month;
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(new Date(y, m - 1, 1));
}

export function formatPercent(value: number, digits = 1): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}
