import type { ReactNode } from "react";

type HighlightedTextProps = {
  text: string;
  terms: string[];
};

function findNextMatch(text: string, terms: string[], start: number): { index: number; length: number } | null {
  const lowerText = text.toLowerCase();
  let next: { index: number; length: number } | null = null;

  for (const term of terms) {
    const normalized = term.trim().toLowerCase();
    if (!normalized) continue;

    const index = lowerText.indexOf(normalized, start);
    if (index < 0) continue;

    if (!next || index < next.index || (index === next.index && normalized.length > next.length)) {
      next = { index, length: normalized.length };
    }
  }

  return next;
}

export function HighlightedText({ text, terms }: HighlightedTextProps) {
  if (!terms.length || !text) {
    return <>{text}</>;
  }

  const parts: ReactNode[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const match = findNextMatch(text, terms, cursor);
    if (!match) {
      parts.push(text.slice(cursor));
      break;
    }

    if (match.index > cursor) {
      parts.push(text.slice(cursor, match.index));
    }

    parts.push(
      <mark className="search-highlight" key={`${match.index}-${match.length}`}>
        {text.slice(match.index, match.index + match.length)}
      </mark>
    );
    cursor = match.index + match.length;
  }

  return <>{parts}</>;
}
