import type { AuraStartData } from "../types";
import { registerBackgroundImageBackup } from "./backgroundImageBackup";
import { registerTimerSoundBackup } from "./timerSoundBackup";
import { dateForFile } from "./dates";
import { downloadBlobFile } from "./download";
import { MAX_ZIP_BACKUP_BYTES } from "./zipBackupFormat";
import type { ParsedZipBackup } from "./zipBackupFormat";
import { getTimerSoundId, timerSoundBytesToDataUrl, validateTimerSoundAsset } from "./timerSoundStorage";
import { validateAuraData } from "./importJson";

export { MAX_ZIP_BACKUP_BYTES } from "./zipBackupFormat";

type WorkRequest = { operation: "create"; data: AuraStartData } | { operation: "parse"; bytes: Uint8Array };

async function runWorker<T>(request: WorkRequest): Promise<T> {
  // Unit tests/non-browser callers have no Worker. Browser work always uses the
  // packaged module; no eval, blob workers, network loader or extra permission.
  if (typeof Worker === "undefined") {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const codec = await import("./zipBackupFormat");
    return (request.operation === "create" ? await codec.encodeZipBackup(request.data) : await codec.decodeZipBackup(request.bytes)) as T;
  }
  return await new Promise<T>((resolve, reject) => {
    const worker = new Worker(new URL("./zipBackup.worker.ts", import.meta.url), { type: "module" });
    const timer = setTimeout(() => finish(new Error("The ZIP backup took too long to process. The original data was preserved.")), 120_000);
    const finish = (error?: Error, result?: T) => {
      clearTimeout(timer);
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    worker.onerror = () => finish(new Error("The local ZIP backup worker could not run. Reload Aura Start and try again."));
    worker.onmessageerror = () => finish(new Error("The ZIP backup worker returned an unreadable result."));
    worker.onmessage = (event: MessageEvent<{ error?: string; result?: T }>) => {
      if (event.data.error) finish(new Error(event.data.error));
      else if (event.data.result === undefined) finish(new Error("The ZIP backup worker returned no data."));
      else finish(undefined, event.data.result);
    };
    try {
      worker.postMessage(request, request.operation === "parse" ? [request.bytes.buffer] : []);
    } catch (error) {
      finish(error instanceof Error ? error : new Error("The ZIP backup worker could not receive the data."));
    }
  });
}

export async function createZipBackup(data: AuraStartData): Promise<Uint8Array> {
  return await runWorker<Uint8Array>({ operation: "create", data: structuredClone(data) });
}

export async function exportZipBackup(data: AuraStartData, filename = `aura-start-backup-${dateForFile()}.zip`): Promise<void> {
  const bytes = await createZipBackup(data);
  downloadBlobFile(filename, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/zip" }));
}

export async function parseZipBackup(bytes: Uint8Array): Promise<AuraStartData> {
  if (bytes.byteLength > MAX_ZIP_BACKUP_BYTES) throw new Error("The ZIP backup exceeds the 256 MiB size limit.");
  // Preserve the caller's input buffer; the copy belongs to the worker.
  const parsed = await runWorker<ParsedZipBackup>({ operation: "parse", bytes: bytes.slice() });
  if (parsed.originalTimerSound) {
    const original = parsed.originalTimerSound;
    // Version 2 contains one original audio file. Rebuild the small playback
    // clip using the same native/local decoder as the sound picker, without
    // writing assets or settings until the caller confirms the import.
    const { prepareTimerSound } = await import("./timerSoundImport");
    const prepared = await prepareTimerSound(new File([original.bytes as Uint8Array<ArrayBuffer>], original.name, { type: original.mimeType }));
    const sound = await validateTimerSoundAsset({ ...prepared, name: original.name,
      dataUrl: timerSoundBytesToDataUrl(original.bytes, original.mimeType) });
    const id = await getTimerSoundId(sound);
    for (const snapshot of [parsed.data, ...parsed.data.restorePoints.map((point) => point.data)]) {
      if (snapshot.settings.timer.customSoundId === original.sourceId) snapshot.settings.timer.customSoundId = id;
      if (snapshot.settingsCompatibility?.preserved["timer.customSoundId"] === original.sourceId) {
        snapshot.settingsCompatibility.preserved["timer.customSoundId"] = id;
      }
    }
    const register = parsed.data.syncReplica?.settings["timer.customSoundId"];
    if (register?.value === original.sourceId) register.value = id;
    parsed.data = validateAuraData(parsed.data);
    parsed.timerSounds[id] = sound;
  }
  registerBackgroundImageBackup(parsed.data, parsed.backgroundImages);
  registerTimerSoundBackup(parsed.data, parsed.timerSounds);
  return parsed.data;
}
