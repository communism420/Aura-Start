import { Pause, Play, RotateCcw, SkipForward, Timer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { t } from "../../i18n";
import type { AuraLanguage, AuraPomodoroSettings } from "../../types";

type PomodoroWidgetProps = {
  language: AuraLanguage;
  settings: AuraPomodoroSettings;
};

type PomodoroMode = "focus" | "break";

function secondsForMode(mode: PomodoroMode, settings: AuraPomodoroSettings): number {
  return (mode === "focus" ? settings.focusMinutes : settings.breakMinutes) * 60;
}

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function PomodoroWidget({ language, settings }: PomodoroWidgetProps) {
  const [mode, setMode] = useState<PomodoroMode>("focus");
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(() => secondsForMode("focus", settings));
  const total = useMemo(() => secondsForMode(mode, settings), [mode, settings]);
  const progress = total > 0 ? 1 - remaining / total : 0;

  useEffect(() => {
    if (running) return;
    setRemaining(secondsForMode(mode, settings));
  }, [mode, running, settings]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setRemaining((current) => {
        if (current > 1) {
          return current - 1;
        }

        setMode((currentMode) => (currentMode === "focus" ? "break" : "focus"));
        return secondsForMode(mode === "focus" ? "break" : "focus", settings);
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [mode, running, settings]);

  const reset = () => {
    setRunning(false);
    setRemaining(secondsForMode(mode, settings));
  };
  const skip = () => {
    const nextMode = mode === "focus" ? "break" : "focus";
    setMode(nextMode);
    setRunning(false);
    setRemaining(secondsForMode(nextMode, settings));
  };

  return (
    <section className="widget-card pomodoro-widget">
      <div className="widget-card-header">
        <div className="widget-title">
          <Timer size={16} />
          <span>{t(language, "widgetPomodoro")}</span>
        </div>
        <span className="pomodoro-mode">{mode === "focus" ? t(language, "pomodoroFocus") : t(language, "pomodoroBreak")}</span>
      </div>
      <div className="pomodoro-time">{formatSeconds(remaining)}</div>
      <div className="pomodoro-progress" aria-hidden="true">
        <span style={{ transform: `scaleX(${Math.min(1, Math.max(0, progress))})` }} />
      </div>
      <div className="widget-button-row">
        <button className="btn btn-secondary" type="button" onClick={() => setRunning((current) => !current)}>
          {running ? <Pause size={15} /> : <Play size={15} />}
          {running ? t(language, "pause") : t(language, "start")}
        </button>
        <button aria-label={t(language, "reset")} className="widget-icon-button" title={t(language, "reset")} type="button" onClick={reset}>
          <RotateCcw size={15} />
        </button>
        <button aria-label={t(language, "skip")} className="widget-icon-button" title={t(language, "skip")} type="button" onClick={skip}>
          <SkipForward size={15} />
        </button>
      </div>
    </section>
  );
}
