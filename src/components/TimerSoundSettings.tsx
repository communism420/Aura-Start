import { Music2, Play, RotateCcw, Square, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { t, type I18nKey } from "../i18n";
import type { AuraLanguage, AuraTimerSettings } from "../types";
import { TimerPlayback } from "../utils/timerPlayback";
import { TIMER_SOUND_ACCEPT, TimerSoundImportError } from "../utils/timerSoundImport";
import { loadTimerSound } from "../utils/timerSoundStorage";

type TimerSoundSettingsProps = {
  language: AuraLanguage;
  settings: AuraTimerSettings;
  onSetSound: (file: File | null) => Promise<void>;
  onVolumeChange: (volume: number) => void;
};

export function TimerSoundSettings({ language, settings, onSetSound, onVolumeChange }: TimerSoundSettingsProps) {
  const [soundName, setSoundName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<I18nKey | null>(null);
  const player = useRef<TimerPlayback | null>(null);
  const request = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => { request.current += 1; player.current?.dispose(); player.current = null; }, []);
  useEffect(() => {
    let active = true;
    player.current?.stop();
    setSoundName(null);
    setNotice(null);
    if (settings.customSoundId) {
      void loadTimerSound(settings.customSoundId).then((sound) => {
        if (!active) return;
        if (sound) setSoundName(sound.name);
        else setNotice("timerSoundLoadError");
      }).catch(() => { if (active) setNotice("timerSoundLoadError"); });
    }
    return () => { active = false; };
  }, [settings.customSoundId]);

  async function chooseSound(file: File | null) {
    const current = ++request.current;
    setBusy(true);
    setNotice(null);
    player.current?.stop();
    try {
      await onSetSound(file);
    } catch (error) {
      if (current !== request.current) return;
      let key: I18nKey = "timerSoundSaveError";
      if (error instanceof TimerSoundImportError) {
        if (error.code === "aborted") return;
        key = error.code === "too-large" ? "timerSoundTooLarge"
          : error.code === "timeout" ? "timerSoundTimeout" : "timerSoundInvalid";
      }
      setNotice(key);
    } finally {
      if (current === request.current) setBusy(false);
    }
  }

  async function preview() {
    setNotice(null);
    const current = request.current;
    const playback = player.current ??= new TimerPlayback();
    const result = await playback.play(settings.customSoundId, settings.volume);
    if (current !== request.current || result.cancelled) return;
    if (!result.played) setNotice("timerSoundBlocked");
    else if (result.fallback) setNotice("timerFallbackSound");
  }

  return (
    <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
      <h4 className="flex items-center gap-2 text-sm font-semibold"><Music2 size={16} />{t(language, "timerSignal")}</h4>
      <p className="break-all text-sm">{settings.customSoundId ? soundName ?? t(language, "timerCustomSound") : t(language, "timerBuiltinSound")}</p>
      <p className="muted text-xs">{t(language, "timerSoundHint")}</p>
      <input ref={fileInput} accept={TIMER_SOUND_ACCEPT} aria-label={t(language, "timerUploadSound")} className="sr-only" tabIndex={-1} type="file" onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void chooseSound(file);
      }} />
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-secondary" type="button" onClick={() => fileInput.current?.click()}><Upload size={16} />{t(language, "timerUploadSound")}</button>
        <button className="btn btn-secondary" type="button" onClick={() => void preview()}><Play size={16} />{t(language, "timerPlaySound")}</button>
        <button className="widget-icon-button" type="button" title={t(language, "timerStopSound")} aria-label={t(language, "timerStopSound")} onClick={() => player.current?.stop()}><Square size={16} /></button>
        {settings.customSoundId || busy ? <button className="btn btn-secondary" type="button" onClick={() => void chooseSound(null)}><RotateCcw size={16} />{t(language, "timerUseBuiltin")}</button> : null}
      </div>
      {busy ? <p className="muted text-sm" role="status">{t(language, "timerPreparingSound")}</p> : null}
      {notice ? <p className="text-sm" role="alert">{t(language, notice)}</p> : null}
      <label className="block text-sm">
        <span className="mb-1 block font-semibold">{t(language, "timerVolume")}: {settings.volume}%</span>
        <input className="w-full" type="range" min={0} max={100} step={1} value={settings.volume} onChange={(event) => {
          player.current?.stop();
          onVolumeChange(Number(event.target.value));
        }} />
      </label>
      <p className="muted text-xs">{t(language, "timerSoundSyncHint")}</p>
    </div>
  );
}
