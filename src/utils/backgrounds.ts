import type { AuraBackgroundPreset } from "../types";

export type AuraBackgroundOption = {
  id: Exclude<AuraBackgroundPreset, "custom" | "none">;
  labelKey: "backgroundPresetAurora" | "backgroundPresetDawn" | "backgroundPresetForest";
  url: string;
};

export const BUILTIN_BACKGROUNDS: AuraBackgroundOption[] = [
  {
    id: "aurora",
    labelKey: "backgroundPresetAurora",
    url: "/backgrounds/aurora.svg"
  },
  {
    id: "dawn",
    labelKey: "backgroundPresetDawn",
    url: "/backgrounds/dawn.svg"
  },
  {
    id: "forest",
    labelKey: "backgroundPresetForest",
    url: "/backgrounds/forest.svg"
  }
];

export function backgroundImageUrl(preset: AuraBackgroundPreset, customImage: string | null): string | undefined {
  if (preset === "custom") {
    return customImage ?? undefined;
  }

  return BUILTIN_BACKGROUNDS.find((background) => background.id === preset)?.url;
}
