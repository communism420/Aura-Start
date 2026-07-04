import packageJson from "../../package.json";

export function getAuraStartVersion(): string {
  return globalThis.chrome?.runtime?.getManifest?.().version
    ?? packageJson.extensionVersions?.chromium
    ?? packageJson.version;
}
