import type { AuraStartData } from "../types";
import { decodeZipBackup, encodeZipBackup } from "./zipBackupFormat";

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<{ operation: "create"; data: AuraStartData } | { operation: "parse"; bytes: Uint8Array }>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

scope.onmessage = (event) => {
  void (async () => {
    try {
      if (event.data.operation === "create") {
        const result = await encodeZipBackup(event.data.data);
        scope.postMessage({ result }, [result.buffer]);
      } else {
        const result = await decodeZipBackup(event.data.bytes);
        scope.postMessage({ result }, result.originalTimerSound ? [result.originalTimerSound.bytes.buffer] : []);
      }
    } catch (error) {
      scope.postMessage({ error: error instanceof Error ? error.message : "The ZIP backup could not be processed." });
    }
  })();
};
