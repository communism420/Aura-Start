import type { CSSProperties } from "react";
import type { AuraBackgroundSettings } from "../types";
import { backgroundImageUrl } from "../utils/backgrounds";

type BackgroundLayerProps = {
  customImage: string | null;
  settings: AuraBackgroundSettings;
};

export function BackgroundLayer({ customImage, settings }: BackgroundLayerProps) {
  const imageUrl = backgroundImageUrl(settings.preset, customImage);
  if (!imageUrl) {
    return null;
  }

  const imageStyle = {
    "--aura-background-image": `url("${imageUrl.replaceAll("\"", "%22")}")`,
    "--aura-background-blur": `${settings.blur}px`,
    "--aura-background-position": settings.position,
    "--aura-background-scale": String(1 + settings.blur / 120)
  } as CSSProperties;
  const dimStyle = {
    "--aura-background-dim": String(settings.dim / 100)
  } as CSSProperties;

  return (
    <div aria-hidden="true" className="aura-background-frame">
      <div className="aura-background-image" style={imageStyle} />
      <div className="aura-background-dim" style={dimStyle} />
    </div>
  );
}
