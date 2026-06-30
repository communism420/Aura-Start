import { Clock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AuraLanguage } from "../../types";

type ClockWidgetProps = {
  language: AuraLanguage;
};

const localeByLanguage: Record<AuraLanguage, string> = {
  de: "de-DE",
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  pt: "pt-BR",
  ru: "ru-RU",
  uk: "uk-UA"
};

export function ClockWidget({ language }: ClockWidgetProps) {
  const [now, setNow] = useState(() => new Date());
  const locale = localeByLanguage[language];
  const time = useMemo(
    () => now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
    [locale, now]
  );
  const date = useMemo(
    () => now.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" }),
    [locale, now]
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="clock-widget" title={date}>
      <Clock size={14} />
      <span className="clock-widget-time">{time}</span>
      <span className="clock-widget-date">{date}</span>
    </div>
  );
}
