const TOGGLE_COMMAND_PALETTE_COMMAND = "toggle-command-palette";
const TOGGLE_COMMAND_PALETTE_MESSAGE = "aura-start:toggle-command-palette";

chrome.commands.onCommand.addListener((command) => {
  if (command !== TOGGLE_COMMAND_PALETTE_COMMAND) return;

  chrome.runtime.sendMessage({ type: TOGGLE_COMMAND_PALETTE_MESSAGE }, () => {
    void chrome.runtime.lastError;
  });
});

export {};
