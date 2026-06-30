const TOGGLE_COMMAND_PALETTE_COMMAND = "toggle-command-palette";
const TOGGLE_COMMAND_PALETTE_MESSAGE = "aura-start:toggle-command-palette";

type BackgroundExtensionApi = Partial<typeof chrome>;

function extensionApi(): BackgroundExtensionApi | undefined {
  const globals = globalThis as typeof globalThis & {
    browser?: BackgroundExtensionApi;
    chrome?: BackgroundExtensionApi;
  };
  return globals.browser ?? globals.chrome;
}

function clearLastError(): void {
  void extensionApi()?.runtime?.lastError;
}

extensionApi()?.commands?.onCommand?.addListener((command) => {
  if (command !== TOGGLE_COMMAND_PALETTE_COMMAND) return;

  const runtime = extensionApi()?.runtime;
  const sent = runtime?.sendMessage?.({ type: TOGGLE_COMMAND_PALETTE_MESSAGE }, clearLastError);
  if (sent && typeof (sent as Promise<unknown>).catch === "function") {
    void (sent as Promise<unknown>).catch(clearLastError);
  }
});

export {};
