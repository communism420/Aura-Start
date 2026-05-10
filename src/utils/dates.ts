export function nowIso(): string {
  return new Date().toISOString();
}

export function dateForFile(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function toUnixSeconds(isoDate: string): number {
  const time = new Date(isoDate).getTime();
  return Number.isFinite(time) ? Math.floor(time / 1000) : Math.floor(Date.now() / 1000);
}

export function formatDateTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}
