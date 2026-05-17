import { DATA_VERSION, DEFAULT_SETTINGS } from "../constants";
import type { AuraStartData, AuraStartGroup, AuraStartLink } from "../types";
import { nowIso } from "./dates";
import { createId } from "./ids";
import { normalizeUrl } from "./validators";

type AfsBookmark = {
  name: string;
  url: string;
};

type AfsGroup = {
  name: string;
  bookmarks: AfsBookmark[];
};

export type AFineStartImportResult = {
  data: AuraStartData;
  warnings: string[];
  rejectedLinks: number;
  sourceGroups: number;
  sourceLinks: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAfsBookmark(value: unknown): value is AfsBookmark {
  return isRecord(value) && typeof value.name === "string" && typeof value.url === "string";
}

function isAfsGroup(value: unknown): value is AfsGroup {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    Array.isArray(value.bookmarks) &&
    value.bookmarks.every(isAfsBookmark)
  );
}

function parseJsonLikeText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Paste the A Fine Start export code first.");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstArray = trimmed.indexOf("[");
    const lastArray = trimmed.lastIndexOf("]");

    if (firstArray >= 0 && lastArray > firstArray) {
      try {
        return JSON.parse(trimmed.slice(firstArray, lastArray + 1));
      } catch {
        throw new Error("A Fine Start export code must be valid JSON. Copy the whole code from Export bookmarks.");
      }
    }

    throw new Error("A Fine Start export code must be valid JSON. Copy the whole code from Export bookmarks.");
  }
}

function parseColumns(value: unknown): AfsGroup[][] {
  if (isRecord(value)) {
    if (Array.isArray(value.columns)) {
      return parseColumns(value.columns);
    }

    if (Array.isArray(value.bookmarks)) {
      return parseColumns(value.bookmarks);
    }

    if (Array.isArray(value.groups)) {
      return parseColumns(value.groups);
    }
  }

  if (!Array.isArray(value)) {
    throw new Error("A Fine Start export must be a JSON array.");
  }

  if (value.every(isAfsGroup)) {
    return [value];
  }

  const maybeV2 = value.length > 0 && value.every((column) => isRecord(column) && Array.isArray(column.groups));
  const columns = maybeV2 ? value.map((column) => (column as { groups: unknown[] }).groups) : value;

  if (!columns.every((column) => Array.isArray(column) && column.every(isAfsGroup))) {
    throw new Error("This does not look like a valid A Fine Start export code.");
  }

  return columns as AfsGroup[][];
}

function isProbablyAFineStartSelfLink(title: string): boolean {
  return title.trim().toLowerCase() === "a fine start";
}

function normalizeAfsBookmarkUrl(title: string, rawUrl: string, groupTitle: string): { url?: string; warning?: string } {
  const normalizedUrl = normalizeUrl(rawUrl);
  if (normalizedUrl.ok) {
    return { url: normalizedUrl.url };
  }

  if (isProbablyAFineStartSelfLink(title)) {
    return {
      url: "https://afinestart.me/bookmarks/",
      warning: `"${title}" in "${groupTitle}" used an internal A Fine Start URL, so it was converted to https://afinestart.me/bookmarks/.`
    };
  }

  return {
    warning: `"${title}" in "${groupTitle}" was skipped: ${normalizedUrl.message}`
  };
}

export function parseAFineStartExportWithReport(text: string): AFineStartImportResult {
  const parsed = parseJsonLikeText(text);
  const columns = parseColumns(parsed);
  const createdAt = nowIso();
  const errors: string[] = [];
  const warnings: string[] = [];
  const groups: AuraStartGroup[] = [];
  let rejectedLinks = 0;
  let sourceGroups = 0;
  let sourceLinks = 0;

  columns.forEach((column) => {
    column.forEach((afsGroup) => {
      sourceGroups += 1;
      const title = afsGroup.name.trim();
      if (!title) {
        errors.push("A group has an empty name.");
        return;
      }

      const links: AuraStartLink[] = [];
      afsGroup.bookmarks.forEach((bookmark) => {
        sourceLinks += 1;
        const linkTitle = bookmark.name.trim();
        if (!linkTitle) {
          errors.push(`A bookmark in "${title}" has an empty title.`);
          return;
        }

        const normalizedUrl = normalizeAfsBookmarkUrl(linkTitle, bookmark.url, title);
        if (normalizedUrl.warning) {
          warnings.push(normalizedUrl.warning);
        }

        if (!normalizedUrl.url) {
          rejectedLinks += 1;
          return;
        }

        links.push({
          id: createId("link"),
          title: linkTitle,
          url: normalizedUrl.url,
          order: links.length,
          createdAt,
          updatedAt: createdAt
        });
      });

      groups.push({
        id: createId("group"),
        title,
        collapsed: false,
        order: groups.length,
        links
      });
    });
  });

  if (errors.length) {
    const visible = errors.slice(0, 5).join(" ");
    const remaining = errors.length > 5 ? ` ${errors.length - 5} more problems were found.` : "";
    throw new Error(`${visible}${remaining}`);
  }

  if (!groups.length || groups.every((group) => group.links.length === 0)) {
    throw new Error("This A Fine Start export does not contain bookmarks to import.");
  }

  return {
    data: {
      version: DATA_VERSION,
      updatedAt: createdAt,
      settings: DEFAULT_SETTINGS,
      groups,
      restorePoints: []
    },
    warnings,
    rejectedLinks,
    sourceGroups,
    sourceLinks
  };
}

export function parseAFineStartExport(text: string): AuraStartData {
  return parseAFineStartExportWithReport(text).data;
}
