import { Bell, BellOff, Hourglass, Pause, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "../../i18n";
import type { AuraLanguage, AuraTimerSettings } from "../../types";
import {
  COUNTDOWN_STORAGE_KEY, advanceCountdown, claimCountdownAlarm, countdownRemainingMs,
  createCountdownRepository, createCountdownSession, formatCountdownTime, normalizeCountdownDuration,
  pauseCountdown, resumeCountdown, startCountdown, stopCountdownAlarm, type CountdownSession
} from "../../utils/countdownTimer";
import { TimerPlayback } from "../../utils/timerPlayback";

type TimerWidgetProps = {
  language: AuraLanguage;
  settings: AuraTimerSettings;
  onDurationChange: (durationSeconds: number) => void;
};

function durationParts(seconds: number): [string, string, string] {
  return [String(Math.floor(seconds / 3600)), String(Math.floor(seconds / 60) % 60), String(seconds % 60)];
}

export function TimerWidget({ language, settings, onDurationChange }: TimerWidgetProps) {
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const playback = useMemo(() => new TimerPlayback(), []);
  const repository = useMemo(() => createCountdownRepository({
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value)
  }, navigator.locks), []);
  const [storageError, setStorageError] = useState(false);
  const [session, setSession] = useState<CountdownSession>(() => {
    try { return repository.read(settings.durationSeconds); } catch { return createCountdownSession(settings.durationSeconds); }
  });
  const [now, setNow] = useState(Date.now);
  const [parts, setParts] = useState(() => durationParts(settings.durationSeconds));
  const [busy, setBusy] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [fallbackSound, setFallbackSound] = useState(false);
  const mounted = useRef(false);
  const completing = useRef(false);
  const claiming = useRef(false);
  const editingDuration = useRef(false);
  const draftSeconds = normalizeCountdownDuration(Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]));

  const acceptSession = useCallback((value: CountdownSession) => {
    if (mounted.current) setSession((current) => JSON.stringify(current) === JSON.stringify(value) ? current : value);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const refresh = () => {
      const time = Date.now();
      setNow(time);
      try {
        const current = repository.read(settingsRef.current.durationSeconds);
        acceptSession(current);
        if (advanceCountdown(current, time) !== current && !completing.current) {
          completing.current = true;
          void repository.update(settingsRef.current.durationSeconds, (latest) => advanceCountdown(latest, Date.now()))
            .then(acceptSession).catch(() => { if (mounted.current) setStorageError(true); })
            .finally(() => { completing.current = false; });
        }
      } catch { setStorageError(true); }
    };
    const storageChanged = (event: StorageEvent) => { if (event.key === COUNTDOWN_STORAGE_KEY || event.key === null) refresh(); };
    refresh();
    const interval = window.setInterval(refresh, 500);
    window.addEventListener("storage", storageChanged);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mounted.current = false;
      window.clearInterval(interval);
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refresh);
      playback.dispose();
    };
  }, [acceptSession, playback, repository]);

  useEffect(() => {
    if (!editingDuration.current && (session.phase === "idle" || session.phase === "complete")) setParts(durationParts(settings.durationSeconds));
  }, [settings.durationSeconds, session.phase]);

  useEffect(() => {
    playback.stop();
    setSoundBlocked(false);
    setFallbackSound(false);
  }, [playback, session.runId, session.phase === "complete", session.alarmStopped, settings.volume, settings.customSoundId]);

  const reportPlayback = useCallback(async () => {
    const preferences = settingsRef.current;
    const result = await playback.play(preferences.customSoundId, preferences.volume);
    if (mounted.current && !result.cancelled) {
      setSoundBlocked(!result.played);
      setFallbackSound(result.fallback && result.played);
    }
  }, [playback]);

  useEffect(() => {
    if (session.phase !== "complete" || session.alarmClaimed || session.alarmStopped || claiming.current) return;
    claiming.current = true;
    const runId = session.runId;
    void (async () => {
      const ready = settingsRef.current.volume === 0 || await playback.prepare();
      if (!mounted.current) return;
      const observed = repository.read(settingsRef.current.durationSeconds);
      if (observed.phase !== "complete" || observed.runId !== runId || observed.alarmStopped || observed.alarmClaimed) return;
      if (!ready && settingsRef.current.volume !== 0) { setSoundBlocked(true); return; }
      let claimed = false;
      const next = await repository.update(settingsRef.current.durationSeconds, (current) => {
        const nextState = claimCountdownAlarm(current, runId);
        claimed = nextState !== current;
        return nextState;
      });
      acceptSession(next);
      const latest = repository.read(settingsRef.current.durationSeconds);
      if (claimed && mounted.current && latest.runId === runId && !latest.alarmStopped) await reportPlayback();
    })().catch(() => { if (mounted.current) setStorageError(true); }).finally(() => { claiming.current = false; });
  }, [acceptSession, playback, reportPlayback, repository, session]);

  const changeSession = async (transform: (current: CountdownSession) => CountdownSession) => {
    setBusy(true);
    try {
      acceptSession(await repository.update(settingsRef.current.durationSeconds, transform));
      setStorageError(false);
      setNow(Date.now());
    } catch { if (mounted.current) setStorageError(true); }
    finally { if (mounted.current) setBusy(false); }
  };

  const toggleRunning = () => {
    if (session.phase === "running") {
      void changeSession((current) => current.runId === session.runId ? pauseCountdown(current, Date.now()) : current);
    } else {
      // Invoke while the click still has browser user activation, before storage awaits.
      if (settingsRef.current.volume !== 0) void playback.prepare();
      if (session.phase === "paused") {
        void changeSession((current) => current.runId === session.runId ? resumeCountdown(current, Date.now()) : current);
      } else {
        setParts(durationParts(draftSeconds));
        onDurationChange(draftSeconds);
        void changeSession((current) => current.phase === "idle" || current.phase === "complete"
          ? startCountdown(draftSeconds, Date.now(), crypto.randomUUID()) : current);
      }
    }
  };

  const stopSignal = () => {
    playback.stop();
    void changeSession((current) => stopCountdownAlarm(current, session.runId));
  };
  const retrySignal = () => {
    // Explicit retry can also play on a page opened after another tab claimed the alarm.
    const ready = settingsRef.current.volume === 0 ? Promise.resolve(true) : playback.prepare();
    const runId = session.runId;
    void (async () => {
      if (!await ready || !mounted.current) return;
      const next = await repository.update(settingsRef.current.durationSeconds, (current) => claimCountdownAlarm(current, runId));
      acceptSession(next);
      if (next.phase === "complete" && next.runId === runId && !next.alarmStopped) await reportPlayback();
    })().catch(() => { if (mounted.current) setStorageError(true); });
  };
  const saveDuration = () => {
    setParts(durationParts(draftSeconds));
    if (draftSeconds !== settings.durationSeconds) onDurationChange(draftSeconds);
  };
  const locked = session.phase === "running" || session.phase === "paused";
  const remaining = session.phase === "idle" ? draftSeconds * 1000 : countdownRemainingMs(session, now);
  const progress = session.phase === "idle" ? 0 : 1 - remaining / session.durationMs;

  return (
    <section className={`widget-card countdown-widget${session.phase === "complete" ? " countdown-complete" : ""}`}>
      <div className="widget-card-header">
        <div className="widget-title"><Hourglass size={16} /><span>{t(language, "widgetTimer")}</span></div>
        {session.phase === "paused" ? <span className="pomodoro-mode">{t(language, "timerPaused")}</span> : null}
        {session.phase === "complete" ? <span className="pomodoro-mode" role="status">{t(language, "timerComplete")}</span> : null}
      </div>
      <div className="pomodoro-time countdown-time" role="timer" aria-label={t(language, "widgetTimer")}>{formatCountdownTime(remaining)}</div>
      <div className="pomodoro-progress" aria-hidden="true"><span style={{ transform: `scaleX(${Math.min(1, Math.max(0, progress))})` }} /></div>
      <div className="countdown-duration" onFocusCapture={() => { editingDuration.current = true; }}
        onBlurCapture={(event) => {
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
          editingDuration.current = false;
          saveDuration();
        }}>
        {(["timerHours", "timerMinutes", "timerSeconds"] as const).map((key, index) => (
          <label key={key}>
            <span>{t(language, key)}</span>
            <input className="field" type="number" inputMode="numeric" min={0} max={index === 0 ? 24 : 59} step={1}
              disabled={locked || busy} value={parts[index]}
              onChange={(event) => {
                const raw = event.target.value;
                const next = raw === "" ? "" : String(Math.max(0, Math.min(index === 0 ? 24 : 59, Math.floor(Number(raw) || 0))));
                setParts((current) => current.map((part, partIndex) => partIndex === index ? next : part) as [string, string, string]);
              }} />
          </label>
        ))}
      </div>
      <div className="widget-button-row">
        <button className="btn btn-secondary" type="button" disabled={busy} onClick={toggleRunning}>
          {session.phase === "running" ? <Pause size={15} /> : <Play size={15} />}
          {session.phase === "running" ? t(language, "pause") : session.phase === "paused" ? t(language, "timerResume") : t(language, "start")}
        </button>
        <button className="widget-icon-button" aria-label={t(language, "reset")} title={t(language, "reset")} type="button" disabled={busy}
          onClick={() => { playback.stop(); void changeSession(() => createCountdownSession(settingsRef.current.durationSeconds)); }}><RotateCcw size={15} /></button>
        {session.phase === "complete" && !session.alarmStopped ? <>
          <button className="btn btn-secondary" type="button" disabled={busy} onClick={stopSignal}><BellOff size={15} />{t(language, "timerStopSound")}</button>
          {soundBlocked ? <button className="btn btn-secondary" type="button" onClick={retrySignal}><Bell size={15} />{t(language, "timerPlaySound")}</button> : null}
        </> : null}
      </div>
      {soundBlocked && !session.alarmStopped ? <p className="countdown-message" role="status">{t(language, "timerSoundBlocked")}</p> : null}
      {fallbackSound ? <p className="countdown-message" role="status">{t(language, "timerFallbackSound")}</p> : null}
      {storageError ? <p className="countdown-message countdown-error" role="alert">{t(language, "timerStorageError")}</p> : null}
      <p className="countdown-hint">{t(language, "timerPageHint")}</p>
    </section>
  );
}
