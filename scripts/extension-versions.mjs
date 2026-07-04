const EXTENSION_VERSION_PATTERN = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){1,3}$/;

export function assertExtensionVersion(version, label = "extension version") {
  const normalized = String(version ?? "").trim();
  if (!EXTENSION_VERSION_PATTERN.test(normalized)) {
    throw new Error(`${label} must use numeric dot notation compatible with browser extension manifests, for example 2.0.1.`);
  }

  return normalized;
}

export function extensionVersionsFromPackage(packageJson) {
  const configuredVersions = packageJson.extensionVersions ?? {};
  return {
    chromium: String(configuredVersions.chromium ?? packageJson.version ?? "").trim(),
    firefox: String(configuredVersions.firefox ?? packageJson.version ?? "").trim()
  };
}

export function resolveExtensionVersion(packageJson, targetBrowser, env = process.env) {
  const target = targetBrowser === "firefox" ? "firefox" : "chromium";
  const targetOverride = target === "firefox"
    ? env.AURA_FIREFOX_EXTENSION_VERSION
    : env.AURA_CHROMIUM_EXTENSION_VERSION;
  const commonOverride = env.AURA_EXTENSION_VERSION;
  const configuredVersions = extensionVersionsFromPackage(packageJson);
  const version = String(targetOverride?.trim() || commonOverride?.trim() || configuredVersions[target]).trim();

  return assertExtensionVersion(version, `${target} extension version`);
}
