import Fuse from "fuse.js";
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
  onSearchLinks?: (query: string) => void;
  onClose: () => void;
  onError: (message: string) => void;
};

function commandFuse(commands: CommandPaletteCommand[]): Fuse<CommandPaletteCommand> {
  return new Fuse(commands, {
    ignoreLocation: true,
    keys: [
      { name: "title", weight: 0.6 },
      { name: "description", weight: 0.25 },
      { name: "keywords", weight: 0.15 }
    ],
    threshold: 0.38
  });
}

export function CommandPalette({ language, open, commands, onSearchLinks, onClose, onError }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const normalizedQuery = query.trim();
  const filteredCommands = useMemo(
    () => (normalizedQuery ? commandFuse(commands).search(normalizedQuery).map((result) => result.item) : commands),
    [commands, normalizedQuery]
  );
  const searchLinksCommand = useMemo<CommandPaletteCommand | null>(
    () =>
      normalizedQuery && onSearchLinks
        ? {
            id: "search-links",
            title: t(language, "commandSearchLinksFor", { query: normalizedQuery }),
            description: t(language, "commandSearchLinksForDescription"),
            action: () => onSearchLinks(normalizedQuery)
          }
        : null,
    [language, normalizedQuery, onSearchLinks]
  );
  const visibleCommands = searchLinksCommand ? [searchLinksCommand, ...filteredCommands] : filteredCommands;
  const selectedCommand = visibleCommands[selectedIndex];

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(0);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (selectedIndex >= visibleCommands.length) {
      setSelectedIndex(Math.max(0, visibleCommands.length - 1));
    }
  }, [selectedIndex, visibleCommands.length]);

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
                  visibleCommands.length ? (current + direction + visibleCommands.length) % visibleCommands.length : 0
                );
                return;
              }

              if (event.key === "Enter") {
                event.preventDefault();
                void runCommand(visibleCommands[selectedIndex]);
              }
            }}
          />
          <button className="btn btn-ghost h-9 w-9 p-0" type="button" aria-label={t(language, "closeDialog")} onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="mt-2 max-h-[min(28rem,60vh)] overflow-y-auto" id="command-palette-listbox" role="listbox">
          {visibleCommands.length ? (
            visibleCommands.map((command, index) => (
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
