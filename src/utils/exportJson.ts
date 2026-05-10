import type { AuraStartData } from "../types";
import { dateForFile } from "./dates";
import { downloadTextFile } from "./download";

export function createJsonBackup(data: AuraStartData): string {
  return JSON.stringify(data, null, 2);
}

export function exportJsonBackup(data: AuraStartData): void {
  downloadTextFile(
    `aura-start-backup-${dateForFile()}.json`,
    createJsonBackup(data),
    "application/json;charset=utf-8"
  );
}
