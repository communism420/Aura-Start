import type { AuraStartData, AuraStartGroup, AuraStartLink } from "../types";
import { dateForFile } from "./dates";
import { downloadTextFile } from "./download";

type AFineStartBookmark = {
  name: string;
  url: string;
};

type AFineStartGroup = {
  name: string;
  bookmarks: AFineStartBookmark[];
};

type AFineStartColumns = AFineStartGroup[][];

function exportColumnCount(data: AuraStartData): number {
  const columns = data.settings.columns === "auto" ? 3 : data.settings.columns;
  return Math.min(Math.max(columns, 1), 7);
}

function safeName(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed || fallback;
}

function uniqueGroupName(group: AuraStartGroup, usedNames: Map<string, number>): string {
  const baseName = safeName(group.title, "Untitled group");
  const key = baseName.toLocaleLowerCase();
  const nextCount = (usedNames.get(key) ?? 0) + 1;
  usedNames.set(key, nextCount);

  return nextCount === 1 ? baseName : `${baseName} (${nextCount})`;
}

function toAFineStartBookmark(link: AuraStartLink): AFineStartBookmark {
  return {
    name: safeName(link.title, link.url),
    url: link.url.trim()
  };
}

export function createAFineStartExportCode(data: AuraStartData): string {
  const columns: AFineStartColumns = Array.from({ length: exportColumnCount(data) }, () => []);
  const usedGroupNames = new Map<string, number>();

  data.groups
    .slice()
    .sort((a, b) => a.order - b.order)
    .forEach((group, groupIndex) => {
      const bookmarks = group.links
        .slice()
        .sort((a, b) => a.order - b.order)
        .filter((link) => link.url.trim())
        .map(toAFineStartBookmark);

      columns[groupIndex % columns.length].push({
        name: uniqueGroupName(group, usedGroupNames),
        bookmarks
      });
    });

  return JSON.stringify(columns);
}

export function exportAFineStartCode(data: AuraStartData): void {
  downloadTextFile(
    `aura-start-for-a-fine-start-${dateForFile()}.txt`,
    createAFineStartExportCode(data),
    "text/plain;charset=utf-8"
  );
}
