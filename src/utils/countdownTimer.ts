export const COUNTDOWN_STORAGE_KEY = "aura-start-countdown-session-v1";
export const COUNTDOWN_LOCK_NAME = "aura-start-countdown-session";
const MAX_DURATION_SECONDS = 86_400;

export type CountdownSession = {
  version: 1;
  runId: string;
  phase: "idle" | "running" | "paused" | "complete";
  durationMs: number;
  remainingMs: number;
  deadlineMs: number | null;
  alarmClaimed: boolean;
  alarmStopped: boolean;
};

export function normalizeCountdownDuration(seconds: number): number {
  return Number.isFinite(seconds) ? Math.min(MAX_DURATION_SECONDS, Math.max(1, Math.round(seconds))) : 300;
}

export function createCountdownSession(seconds: number): CountdownSession {
  const durationMs = normalizeCountdownDuration(seconds) * 1000;
  return { version: 1, runId: "", phase: "idle", durationMs, remainingMs: durationMs, deadlineMs: null, alarmClaimed: false, alarmStopped: false };
}

export function parseCountdownSession(raw: string | null, defaultSeconds: number): CountdownSession {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== "object" || Array.isArray(value)) return createCountdownSession(defaultSeconds);
    const state = value as CountdownSession;
    if (state.version !== 1 || !["idle", "running", "paused", "complete"].includes(state.phase)
      || typeof state.runId !== "string" || state.runId.length > 128
      || !Number.isInteger(state.durationMs) || state.durationMs < 1000 || state.durationMs > MAX_DURATION_SECONDS * 1000
      || !Number.isFinite(state.remainingMs) || state.remainingMs < 0 || state.remainingMs > state.durationMs
      || typeof state.alarmClaimed !== "boolean" || typeof state.alarmStopped !== "boolean") return createCountdownSession(defaultSeconds);
    if (state.phase === "running" ? !Number.isSafeInteger(state.deadlineMs) || state.deadlineMs! <= 0 : state.deadlineMs !== null) return createCountdownSession(defaultSeconds);
    if ((state.phase !== "idle" && !state.runId) || (state.phase === "complete" && state.remainingMs !== 0)
      || (state.phase === "paused" && state.remainingMs === 0)) return createCountdownSession(defaultSeconds);
    return { version: 1, runId: state.runId, phase: state.phase, durationMs: state.durationMs, remainingMs: state.remainingMs, deadlineMs: state.deadlineMs, alarmClaimed: state.alarmClaimed, alarmStopped: state.alarmStopped };
  } catch {
    return createCountdownSession(defaultSeconds);
  }
}

/** Deadlines survive page refreshes and background-tab interval throttling. */
export function countdownRemainingMs(state: CountdownSession, now: number): number {
  return state.phase === "running" ? Math.max(0, Math.min(state.durationMs, state.deadlineMs! - now)) : state.remainingMs;
}

export function advanceCountdown(state: CountdownSession, now: number): CountdownSession {
  return state.phase === "running" && countdownRemainingMs(state, now) === 0
    ? { ...state, phase: "complete", remainingMs: 0, deadlineMs: null }
    : state;
}

export function startCountdown(seconds: number, now: number, runId: string): CountdownSession {
  const state = createCountdownSession(seconds);
  return { ...state, runId, phase: "running", deadlineMs: now + state.durationMs };
}

export function pauseCountdown(state: CountdownSession, now: number): CountdownSession {
  const advanced = advanceCountdown(state, now);
  return advanced.phase === "running"
    ? { ...advanced, phase: "paused", remainingMs: countdownRemainingMs(advanced, now), deadlineMs: null }
    : advanced;
}

export function resumeCountdown(state: CountdownSession, now: number): CountdownSession {
  return state.phase === "paused" ? { ...state, phase: "running", deadlineMs: now + state.remainingMs } : state;
}

export function claimCountdownAlarm(state: CountdownSession, runId: string): CountdownSession {
  return state.phase === "complete" && state.runId === runId && !state.alarmClaimed && !state.alarmStopped
    ? { ...state, alarmClaimed: true }
    : state;
}

export function stopCountdownAlarm(state: CountdownSession, runId: string): CountdownSession {
  return state.phase === "complete" && state.runId === runId ? { ...state, alarmStopped: true } : state;
}

type CountdownStorage = Pick<Storage, "getItem" | "setItem">;
type CountdownLock = { request: <T>(name: string, callback: () => T | Promise<T>) => Promise<T> };

/** Only session timing lives here. Preferences and sound assets use Aura's usual storage. */
export function createCountdownRepository(storage: CountdownStorage, locks?: CountdownLock) {
  let pending: Promise<unknown> = Promise.resolve();
  const read = (seconds: number) => parseCountdownSession(storage.getItem(COUNTDOWN_STORAGE_KEY), seconds);
  return {
    read,
    update(seconds: number, transform: (current: CountdownSession) => CountdownSession): Promise<CountdownSession> {
      const operation = () => {
        const current = read(seconds);
        const next = transform(current);
        if (next !== current) storage.setItem(COUNTDOWN_STORAGE_KEY, JSON.stringify(next));
        return next;
      };
      const result = pending.catch(() => undefined).then(() => locks ? locks.request(COUNTDOWN_LOCK_NAME, operation) : operation());
      pending = result;
      return result;
    }
  };
}

export function formatCountdownTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const remainder = seconds % 60;
  return `${hours ? `${String(hours).padStart(2, "0")}:` : ""}${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
