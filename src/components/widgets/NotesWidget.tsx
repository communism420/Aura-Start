import { Eye, PencilLine, StickyNote } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { t } from "../../i18n";
import type { AuraLanguage } from "../../types";

type NotesWidgetProps = {
  language: AuraLanguage;
  value: string;
  onChange: (value: string) => void;
};

function renderInline(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={`${part}-${index}`}>{part.slice(1, -1)}</em>;
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function MarkdownPreview({ language, value }: { language: AuraLanguage; value: string }) {
  const lines = value.trim() ? value.split(/\r?\n/) : [];

  if (!lines.length) {
    return <p className="muted">{t(language, "widgetNotesEmpty")}</p>;
  }

  const blocks: ReactNode[] = [];
  let pendingListItems: string[] = [];
  const flushList = () => {
    if (!pendingListItems.length) return;
    const items = pendingListItems;
    pendingListItems = [];
    blocks.push(
      <ul key={`list-${blocks.length}`}>
        {items.map((item, index) => (
          <li key={`${index}-${item}`}>{renderInline(item)}</li>
        ))}
      </ul>
    );
  };

  lines.forEach((line, index) => {
    const key = `${index}-${line}`;
    if (!line.trim()) {
      flushList();
      blocks.push(<div className="notes-widget-spacer" key={key} />);
      return;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      pendingListItems.push(line.replace(/^\s*[-*]\s+/, ""));
      return;
    }

    flushList();
    if (line.startsWith("### ")) {
      blocks.push(<h4 key={key}>{renderInline(line.slice(4))}</h4>);
      return;
    }
    if (line.startsWith("## ")) {
      blocks.push(<h3 key={key}>{renderInline(line.slice(3))}</h3>);
      return;
    }
    if (line.startsWith("# ")) {
      blocks.push(<h2 key={key}>{renderInline(line.slice(2))}</h2>);
      return;
    }
    blocks.push(<p key={key}>{renderInline(line)}</p>);
  });
  flushList();

  return (
    <div className="notes-widget-preview">
      {blocks}
    </div>
  );
}

export function NotesWidget({ language, value, onChange }: NotesWidgetProps) {
  const [editing, setEditing] = useState(!value.trim());
  const [draft, setDraft] = useState(value);
  const dirty = draft !== value;
  const preview = useMemo(() => <MarkdownPreview language={language} value={draft} />, [draft, language]);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => onChange(draft), 450);
    return () => window.clearTimeout(timer);
  }, [dirty, draft, onChange]);

  return (
    <section className="widget-card notes-widget">
      <div className="widget-card-header">
        <div className="widget-title">
          <StickyNote size={16} />
          <span>{t(language, "widgetNotes")}</span>
        </div>
        <button
          aria-label={editing ? t(language, "preview") : t(language, "edit")}
          className="widget-icon-button"
          title={editing ? t(language, "preview") : t(language, "edit")}
          type="button"
          onClick={() => setEditing((current) => !current)}
        >
          {editing ? <Eye size={15} /> : <PencilLine size={15} />}
        </button>
      </div>
      {editing ? (
        <textarea
          className="field notes-widget-editor"
          maxLength={12_000}
          placeholder={t(language, "widgetNotesPlaceholder")}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      ) : (
        preview
      )}
    </section>
  );
}
