import type { AuraStartData } from "../types";
import { dateForFile } from "./dates";
import { downloadTextFile } from "./download";

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }

  return value;
}

export function createCsvBookmarks(data: AuraStartData): string {
  const rows = [["group", "title", "url", "description", "tags", "createdAt", "updatedAt"]];

  data.groups
    .slice()
    .sort((a, b) => a.order - b.order)
    .forEach((group) => {
      group.links
        .slice()
        .sort((a, b) => a.order - b.order)
        .forEach((link) => {
          rows.push([
            group.title,
            link.title,
            link.url,
            link.description ?? "",
            link.tags?.join(";") ?? "",
            link.createdAt,
            link.updatedAt
          ]);
        });
    });

  return `${rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n")}\n`;
}

export function exportCsv(data: AuraStartData): void {
  downloadTextFile(
    `aura-start-bookmarks-${dateForFile()}.csv`,
    createCsvBookmarks(data),
    "text/csv;charset=utf-8"
  );
}
