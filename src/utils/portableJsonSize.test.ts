import { describe, expect, it } from "vitest";
import { MAX_PORTABLE_JSON_BYTES, PortableJsonBudget } from "./portableJsonSize";

const encodedSize = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, 2)).byteLength;

describe("portable JSON size budget", () => {
  it.each([
    { name: "Alarm.wav", dataUrl: "data:audio/wav;base64,AQID", ids: ["id", null, true, 1.5] },
    { name: "Сигнал 🎵.wav", text: "quote\" slash\\\n\r\t\b\f\u0000\ud800", empty: {}, list: [] },
    { negative: -0, large: 1e25, ignored: undefined, nested: { array: [undefined, "終"] } }
  ])("matches actual pretty-printed UTF-8 JSON including escaped and Unicode text", (value) => {
    const budget = new PortableJsonBudget();
    budget.add(value);
    expect(budget.bytes).toBe(encodedSize(value));
  });

  it("counts document, image and each audio asset before building a single large JSON string", () => {
    const document = { settings: { timer: { customSoundId: "a" } }, restorePoints: [] };
    const images = { backgroundImages: { image: "data:image/png;base64,AQID" } };
    const sound = { a: { name: "alarm.wav", dataUrl: "data:audio/wav;base64,AQID", playbackDataUrl: "data:audio/wav;base64,AQID" } };
    const budget = new PortableJsonBudget();
    budget.add(document);
    budget.add(images);
    budget.add({ timerSounds: {} });
    budget.add(sound, 1);
    const final = { ...document, ...images, timerSounds: sound };
    expect(budget.bytes).toBeGreaterThanOrEqual(encodedSize(final));
    const small = new PortableJsonBudget(budget.bytes - 1);
    small.add(document);
    small.add(images);
    small.add({ timerSounds: {} });
    expect(() => small.add(sound, 1)).toThrow(/Remove unneeded Restore Points/);
    expect(MAX_PORTABLE_JSON_BYTES).toBe(256 * 1024 * 1024);
  });

  it("accepts its exact boundary, then rejects additional assets without large test allocations", () => {
    const value = { name: "chime" };
    const budget = new PortableJsonBudget(encodedSize(value));
    budget.add(value);
    expect(() => budget.add({})).toThrow(/No data was omitted/);
  });
});
