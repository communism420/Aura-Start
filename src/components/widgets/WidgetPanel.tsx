import { t } from "../../i18n";
import type { AuraLanguage, AuraStartSettings } from "../../types";
import { NotesWidget } from "./NotesWidget";
import { PomodoroWidget } from "./PomodoroWidget";
import { TimerWidget } from "./TimerWidget";

type WidgetPanelProps = {
  language: AuraLanguage;
  notes: string;
  settings: AuraStartSettings;
  onNotesChange: (value: string) => Promise<void>;
  onTimerDurationChange: (durationSeconds: number) => void;
};

export function WidgetPanel({ language, notes, settings, onNotesChange, onTimerDurationChange }: WidgetPanelProps) {
  const hasWidgets = settings.widgets.notes || settings.widgets.pomodoro || settings.widgets.timer;
  if (!hasWidgets) {
    return null;
  }

  return (
    <section className="widget-panel" aria-label={t(language, "widgets")}>
      {settings.widgets.notes ? <NotesWidget language={language} value={notes} onChange={onNotesChange} /> : null}
      {settings.widgets.pomodoro ? <PomodoroWidget language={language} settings={settings.pomodoro} /> : null}
      {settings.widgets.timer ? <TimerWidget language={language} settings={settings.timer} onDurationChange={onTimerDurationChange} /> : null}
    </section>
  );
}
