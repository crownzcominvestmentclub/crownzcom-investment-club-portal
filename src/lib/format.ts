// Display + numeric formatting helpers.

export const UGX = "UGX";

export function formatUGX(value: number | undefined | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";

  const roundedToWhole = Math.round(value);
  const hasDecimals = Math.abs(value - roundedToWhole) >= 0.005;

  return new Intl.NumberFormat("en-UG", {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: hasDecimals ? 2 : 0,
  }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-UG").format(value);
}

export function formatDate(value: string | Date | number | undefined | null): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : typeof value === "number" ? new Date(value) : value instanceof Date ? value : null;
  if (!d || isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

export function formatDateTime(value: string | Date | number | undefined | null): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : typeof value === "number" ? new Date(value) : value instanceof Date ? value : null;
  if (!d || isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function formatMonth(month: string): string {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return month;
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(new Date(y, m - 1, 1));
}

export function formatPercent(value: number, digits = 1): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  return `${value.toFixed(digits)}%`;
}

export function initials(name?: string): string {
  if (!name) return "";
  return String(name)
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}
