import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n";
import type { AuraLanguage } from "../types";

export type CommandPaletteCommand = {
  id: string;
  title: string;
  description?: string;
  keywords?: string[];
  action: () => void | Promise<void>;
};

type CommandPaletteProps = {
  language: AuraLanguage;
  open: boolean;
  commands: CommandPaletteCommand[];
  onClose: () => void;
  onError: (message: string) => void;
};

function commandMatches(command: CommandPaletteCommand, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const haystack = [command.title, command.description ?? "", ...(command.keywords ?? [])].join(" ").toLowerCase();
  return haystack.includes(normalized);
}

export function CommandPalette({ language, open, commands, onClose, onError }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const filteredCommands = useMemo(
    () => commands.filter((command) => commandMatches(command, query)),
    [commands, query]
  );
  const selectedCommand = filteredCommands[selectedIndex];

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(0);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (selectedIndex >= filteredCommands.length) {
      setSelectedIndex(Math.max(0, filteredCommands.length - 1));
    }
  }, [filteredCommands.length, selectedIndex]);

  if (!open) return null;

  const runCommand = async (command: CommandPaletteCommand | undefined) => {
    if (!command) return;
    onClose();
    try {
      await command.action();
    } catch (error) {
      onError(error instanceof Error ? error.message : t(language, "commandFailed"));
    }
  };

  return (
    <div
      aria-label={t(language, "commandPalette")}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/34 px-4 py-20 backdrop-blur-sm"
      role="dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="command-palette surface w-full max-w-2xl rounded-xl p-3">
        <div className="flex items-center gap-2 border-b border-[var(--border)] pb-3">
          <Search aria-hidden="true" className="text-[var(--muted)]" size={18} />
          <input
            aria-label={t(language, "typeACommand")}
            aria-activedescendant={selectedCommand ? `command-palette-${selectedCommand.id}` : undefined}
            aria-controls="command-palette-listbox"
            className="command-palette-input"
            placeholder={t(language, "typeACommand")}
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
              }

              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const direction = event.key === "ArrowDown" ? 1 : -1;
                setSelectedIndex((current) =>
                  filteredCommands.length ? (current + direction + filteredCommands.length) % filteredCommands.length : 0
                );
                return;
              }

              if (event.key === "Enter") {
                event.preventDefault();
                void runCommand(filteredCommands[selectedIndex]);
              }
            }}
          />
          <button className="btn btn-ghost h-9 w-9 p-0" type="button" aria-label={t(language, "closeDialog")} onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="mt-2 max-h-[min(28rem,60vh)] overflow-y-auto" id="command-palette-listbox" role="listbox">
          {filteredCommands.length ? (
            filteredCommands.map((command, index) => (
              <button
                aria-selected={index === selectedIndex}
                className={`command-palette-item ${index === selectedIndex ? "command-palette-item-selected" : ""}`}
                id={`command-palette-${command.id}`}
                key={command.id}
                role="option"
                type="button"
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => void runCommand(command)}
              >
                <span className="font-semibold">{command.title}</span>
                {command.description ? <span className="muted text-sm">{command.description}</span> : null}
              </button>
            ))
          ) : (
            <div className="muted p-4 text-center text-sm">{t(language, "noCommandsFound")}</div>
          )}
        </div>
      </section>
    </div>
  );
}
