import type { AuraStartData } from "../types";
import { dateForFile, toUnixSeconds } from "./dates";
import { downloadTextFile } from "./download";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function createHtmlBookmarks(data: AuraStartData): string {
  const lines = [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Bookmarks</TITLE>",
    "<H1>Bookmarks</H1>",
    "<DL><p>"
  ];

  data.groups
    .slice()
    .sort((a, b) => a.order - b.order)
    .forEach((group) => {
      lines.push(`  <DT><H3>${escapeHtml(group.title)}</H3>`);
      lines.push("  <DL><p>");

      group.links
        .slice()
        .sort((a, b) => a.order - b.order)
        .forEach((link) => {
          const addDate = toUnixSeconds(link.createdAt);
          lines.push(
            `    <DT><A HREF="${escapeHtml(link.url)}" ADD_DATE="${addDate}">${escapeHtml(
              link.title
            )}</A>`
          );
        });

      lines.push("  </DL><p>");
    });

  lines.push("</DL><p>");
  return `${lines.join("\n")}\n`;
}

export function exportHtmlBookmarks(data: AuraStartData): void {
  downloadTextFile(
    `aura-start-bookmarks-${dateForFile()}.html`,
    createHtmlBookmarks(data),
    "text/html;charset=utf-8"
  );
}
