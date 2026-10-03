import { describe, expect, it } from "vitest";
import {
  advanceCountdown, claimCountdownAlarm, countdownRemainingMs, createCountdownRepository, createCountdownSession,
  formatCountdownTime, normalizeCountdownDuration, parseCountdownSession, pauseCountdown, resumeCountdown,
  startCountdown, stopCountdownAlarm
} from "./countdownTimer";

describe("countdown session", () => {
  it("counts against a persisted deadline after throttling and refresh", () => {
    const running = startCountdown(300, 1000, "run-1");
    const restored = parseCountdownSession(JSON.stringify(running), 60);
    expect(countdownRemainingMs(restored, 241_000)).toBe(60_000);
    expect(advanceCountdown(restored, 301_000)).toMatchObject({ phase: "complete", remainingMs: 0, deadlineMs: null, alarmClaimed: false });
    expect(countdownRemainingMs(restored, 900_000)).toBe(0);
  });

  it("pauses precise remaining milliseconds and resumes independently of the pause length", () => {
    const paused = pauseCountdown(startCountdown(60, 1000, "run-1"), 24_123);
    expect(paused).toMatchObject({ phase: "paused", remainingMs: 36_877, deadlineMs: null });
    expect(countdownRemainingMs(paused, 9_000_000)).toBe(36_877);
    const resumed = resumeCountdown(paused, 10_000_000);
    expect(resumed.deadlineMs).toBe(10_036_877);
    expect(resumed.runId).toBe("run-1");
    expect(countdownRemainingMs(resumed, 10_030_000)).toBe(6877);
  });

  it("a late pause completes the timer and cannot resurrect it through resume", () => {
    const completed = pauseCountdown(startCountdown(1, 1000, "run-1"), 2000);
    expect(completed.phase).toBe("complete");
    expect(resumeCountdown(completed, 5000)).toBe(completed);
  });

  it("only claims the matching completed run and preserves acknowledgement across refresh", () => {
    const running = startCountdown(1, 1000, "run-1");
    expect(claimCountdownAlarm(running, "run-1")).toBe(running);
    const complete = advanceCountdown(running, 2000);
    expect(claimCountdownAlarm(complete, "old-run")).toBe(complete);
    const claimed = claimCountdownAlarm(complete, "run-1");
    expect(claimCountdownAlarm(claimed, "run-1")).toBe(claimed);
    const stopped = stopCountdownAlarm(complete, "run-1");
    expect(claimCountdownAlarm(stopped, "run-1")).toBe(stopped);
    expect(parseCountdownSession(JSON.stringify(stopped), 300)).toEqual(stopped);
  });

  it("does not apply changed default preferences to a running or paused session", () => {
    const paused = pauseCountdown(startCountdown(120, 1000, "run-1"), 31_000);
    expect(parseCountdownSession(JSON.stringify(paused), 900)).toEqual(paused);
    expect(createCountdownSession(900).remainingMs).toBe(900_000);
  });

  it("rejects corrupted and impossible sessions without losing timer usability", () => {
    const running = startCountdown(60, 1000, "run-1");
    for (const corrupt of ["{", "null", "[]", JSON.stringify({ ...running, deadlineMs: null }), JSON.stringify({ ...running, durationMs: 0 }),
      JSON.stringify({ ...running, remainingMs: 90_000 }), JSON.stringify({ ...running, phase: "complete", deadlineMs: null }),
      JSON.stringify({ ...running, runId: "" }), JSON.stringify({ ...running, alarmStopped: "true" })]) {
      expect(parseCountdownSession(corrupt, 180)).toEqual(createCountdownSession(180));
    }
  });

  it("bounds duration and formats hour-long countdowns without rounding down early", () => {
    expect(normalizeCountdownDuration(0)).toBe(1);
    expect(normalizeCountdownDuration(Infinity)).toBe(300);
    expect(normalizeCountdownDuration(100_000)).toBe(86_400);
    expect(formatCountdownTime(1)).toBe("00:01");
    expect(formatCountdownTime(3_661_000)).toBe("01:01:01");
    expect(formatCountdownTime(86_400_000)).toBe("24:00:00");
  });

  it("two independent tabs share the session and only one claims its sound", async () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    let pending: Promise<unknown> = Promise.resolve();
    const locks = { request: <T>(_name: string, callback: () => T | Promise<T>): Promise<T> => {
      const next = pending.then(callback);
      pending = next;
      return next;
    } };
    const tabA = createCountdownRepository(storage, locks);
    const tabB = createCountdownRepository(storage, locks);
    await tabA.update(300, () => startCountdown(10, 1000, "run-1"));
    expect(tabB.read(300).deadlineMs).toBe(11_000);
    await Promise.all([tabA.update(300, (state) => advanceCountdown(state, 11_000)), tabB.update(300, (state) => advanceCountdown(state, 12_000))]);
    const claims: boolean[] = [];
    await Promise.all([tabA, tabB].map((tab) => tab.update(300, (state) => {
      const next = claimCountdownAlarm(state, "run-1");
      claims.push(next !== state);
      return next;
    })));
    expect(claims.filter(Boolean)).toHaveLength(1);
    await tabB.update(300, (state) => stopCountdownAlarm(state, "run-1"));
    expect(tabA.read(300).alarmStopped).toBe(true);
  });

  it("storage failures reject instead of claiming success and later actions recover", async () => {
    let fail = true;
    let saved: string | null = null;
    const repository = createCountdownRepository({ getItem: () => saved, setItem: (_key, value) => { if (fail) throw new Error("quota"); saved = value; } });
    await expect(repository.update(300, () => startCountdown(1, 1000, "run-1"))).rejects.toThrow("quota");
    expect(repository.read(300).phase).toBe("idle");
    fail = false;
    await repository.update(300, () => startCountdown(1, 1000, "run-2"));
    expect(repository.read(300).runId).toBe("run-2");
  });
});
