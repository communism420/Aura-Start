import type { AuraStartData } from "../types";
import { dateForFile } from "./dates";
import { downloadTextFile } from "./download";
import { buildGroupTree } from "./groupTree";

function cleanMarkdownText(value: string): string {
  return value.replaceAll("\r", " ").replaceAll("\n", " ").trim();
}

function escapeMarkdownLinkText(value: string): string {
  return cleanMarkdownText(value).replaceAll("[", "\\[").replaceAll("]", "\\]");
}

export function createMarkdownBookmarks(data: AuraStartData): string {
  const lines = ["# Aura Start Bookmarks", ""];

  function addGroup(group: ReturnType<typeof buildGroupTree>[number]) {
    lines.push(`${group.depth === 0 ? "##" : "###"} ${cleanMarkdownText(group.title)}`, "");

    group.links
      .slice()
      .sort((a, b) => a.order - b.order)
      .forEach((link) => {
        lines.push(`- [${escapeMarkdownLinkText(link.title)}](${link.url})`);
        if (link.description) {
          lines.push(`  ${cleanMarkdownText(link.description)}`);
        }
        if (link.tags?.length) {
          lines.push(`  Tags: ${link.tags.map((tag) => `\`${cleanMarkdownText(tag)}\``).join(", ")}`);
        }
      });

    lines.push("");
    group.children.forEach(addGroup);
  }

  buildGroupTree(data.groups).forEach(addGroup);

  return `${lines.join("\n").trim()}\n`;
}

export function exportMarkdown(data: AuraStartData): void {
  downloadTextFile(
    `aura-start-bookmarks-${dateForFile()}.md`,
    createMarkdownBookmarks(data),
    "text/markdown;charset=utf-8"
  );
}
