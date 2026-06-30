import type { AuraStartData } from "../types";
import { dateForFile, toUnixSeconds } from "./dates";
import { downloadTextFile } from "./download";
import { buildGroupTree } from "./groupTree";

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

  function addGroup(group: ReturnType<typeof buildGroupTree>[number], indent: string) {
    lines.push(`${indent}<DT><H3>${escapeHtml(group.title)}</H3>`);
    lines.push(`${indent}<DL><p>`);

    group.links
      .slice()
      .sort((a, b) => a.order - b.order)
      .forEach((link) => {
        const addDate = toUnixSeconds(link.createdAt);
        lines.push(
          `${indent}  <DT><A HREF="${escapeHtml(link.url)}" ADD_DATE="${addDate}">${escapeHtml(
            link.title
          )}</A>`
        );
      });

    group.children.forEach((child) => addGroup(child, `${indent}  `));
    lines.push(`${indent}</DL><p>`);
  }

  buildGroupTree(data.groups).forEach((group) => addGroup(group, "  "));

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
