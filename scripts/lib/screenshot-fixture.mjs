// Data fixtures only. All markup, styles, fonts and controls come from Aura Start.
export function createScreenshotData(now = new Date().toISOString()) {
  const link = (id, title, url, order) => ({ id, title, url, order, description: "", tags: [], createdAt: now, updatedAt: now });
  const group = (id, title, order, links, parentId = null) => ({ id, title, order, links, parentId, collapsed: false });
  return {
    version: 1, updatedAt: now, restorePoints: [],
    settings: {
      theme: "dark", language: "en", columns: 2, compactMode: false,
      openLinksInNewTab: false, showDescriptions: true, showSearch: true,
      showVersionInHeader: true, captureOpenTabs: true, autoRestorePoints: true,
      background: { preset: "aurora", blur: 0, dim: 65, position: "center", customImageId: null },
      widgets: { clock: true, notes: true, pomodoro: false, timer: false },
      pomodoro: { focusMinutes: 25, breakMinutes: 5 },
      timer: { durationSeconds: 900, volume: 80, customSoundId: null },
      notes: { text: "**Today**\n- Sketch the next idea\n- Make time for the reading list" },
      sync: { mode: "off", deviceId: "screenshot-device", connected: false, deleteCloudFileOnDisconnect: true }
    },
    groups: [
      group("daily", "Daily", 0, [link("dashboard", "Project dashboard", "https://example.com/dashboard", 0), link("mail", "Inbox", "https://mail.example.com", 1), link("calendar", "Calendar", "https://calendar.example.com", 2)]),
      group("research", "Research", 1, [link("design", "Design notes", "https://example.com/design", 0), link("reading", "Reading list", "https://example.com/reading", 1), link("archive", "Archive", "https://web.archive.org", 2)]),
      group("deep", "Deep dives", 0, [link("mdn", "MDN Web Docs", "https://developer.mozilla.org", 0), link("wiki", "Wikipedia", "https://wikipedia.org", 1)], "research"),
      group("tools", "Tools", 2, [link("figma", "Figma", "https://figma.com", 0), link("github", "GitHub", "https://github.com", 1), link("status", "Service status", "https://status.example.com", 2)]),
      group("personal", "Personal", 3, [link("notes", "Notes", "https://notes.example.com", 0), link("travel", "Travel ideas", "https://example.com/travel", 1)])
    ]
  };
}

function installFixture({ data, manifest }) {
  if (location.protocol !== "http:" || location.hostname !== "127.0.0.1") return;
  const view = new URL(location.href).searchParams.get("view");
  if (view === "countdown") {
    data.settings.widgets.timer = true;
    data.groups = data.groups.filter((group) => ["daily", "tools"].includes(group.id));
  }
  if (view === "sound") data.settings.widgets.timer = true;
  const clone = (value) => value === undefined ? undefined : structuredClone(value);
  const store = {
    "aura-start-data-v1": data,
    "aura-start-ui-state-v1": { onboardingCompleted: true, demoData: { groupIds: [], linkIds: [] }, lastSearchQuery: "", searchFilter: "all", customBackgroundImage: null }
  };
  const listeners = new Set();
  const notify = (changes) => queueMicrotask(() => listeners.forEach((listener) => listener(changes, "local")));
  const storage = {
    get(key, callback) {
      let result;
      if (typeof key === "string") result = { [key]: clone(store[key]) };
      else if (Array.isArray(key)) result = Object.fromEntries(key.map((item) => [item, clone(store[item])]));
      else if (key && typeof key === "object") result = Object.fromEntries(Object.entries(key).map(([item, fallback]) => [item, clone(store[item] ?? fallback)]));
      else result = clone(store);
      callback?.(result);
      return Promise.resolve(result);
    },
    set(items, callback) {
      const changes = Object.fromEntries(Object.entries(items).map(([key, value]) => [key, { oldValue: clone(store[key]), newValue: clone(value) }]));
      Object.assign(store, clone(items));
      callback?.();
      notify(changes);
      return Promise.resolve();
    },
    remove(keys, callback) {
      const changes = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) { changes[key] = { oldValue: clone(store[key]) }; delete store[key]; }
      callback?.();
      notify(changes);
      return Promise.resolve();
    }
  };
  const api = globalThis.chrome ?? {};
  api.storage = { local: storage, onChanged: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) } };
  // No extension ID, background worker, authorization API or fake connected account.
  api.runtime = { getManifest: () => clone(manifest) };
  globalThis.chrome = api;
}

export function screenshotFixtureSource(manifest, now) {
  return `(${installFixture.toString()})(${JSON.stringify({ data: createScreenshotData(now), manifest: { manifest_version: manifest.manifest_version, name: manifest.name, version: manifest.version } })});`;
}

export function createDemoChime() {
  const rate = 24000;
  const frames = rate * 2;
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(frames * 2, 40);
  for (let index = 0; index < frames; index++) {
    const seconds = index / rate;
    const envelope = Math.min(1, seconds / 0.01) * Math.exp(-seconds * 3);
    const sample = 0.2 * envelope * (Math.sin(2 * Math.PI * 660 * seconds) + 0.5 * Math.sin(2 * Math.PI * 990 * seconds));
    wav.writeInt16LE(Math.round(sample * 32767), 44 + index * 2);
  }
  return wav;
}
