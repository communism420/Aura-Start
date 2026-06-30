import type { AuraStartData, AuraSyncSettings } from "../types";
import { getAuraStartVersion } from "../utils/appVersion";
import {
  createExtensionTab,
  getExtensionAuthToken,
  getExtensionManifest,
  getExtensionProfileUserInfo,
  getExtensionRedirectUrl,
  getExtensionRuntimeId,
  getExtensionStorageArea,
  hasExtensionIdentityApi,
  hasExtensionIdentityGetAuthToken,
  hasExtensionWebAuthFlow,
  launchExtensionWebAuthFlow,
  removeCachedExtensionAuthToken,
  requestExtensionDataCollectionPermissions,
  type ExtensionDataCollectionPermission,
  type ExtensionStorageArea
} from "../utils/browserApi";
import { nowIso } from "../utils/dates";
import { validateAuraData } from "../utils/importJson";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_DEVICE_CODE_URL = "https://oauth2.googleapis.com/device/code";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const OAUTH_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const DRIVE_APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DEVICE_OAUTH_DRIVE_SCOPE = DRIVE_FILE_SCOPE;
const SYNC_FILE_NAME = "aura-start-sync.json";
const SYNC_FILE_APP_PROPERTY = "auraStartSync";
const SYNC_FILE_APP_PROPERTY_VALUE = "true";
const CLOUD_SCHEMA_VERSION = 1;
const CLOUD_APP_NAME = "Aura Start";
const PUBLISHED_CHROME_WEB_STORE_EXTENSION_ID = "pdhhnnmcampmmklkbbtfbmnijmgjliabi";
const TOKEN_EXPIRY_SAFETY_MS = 60_000;
const CHROME_IDENTITY_PROBE_TIMEOUT_MS = 2_500;
const DEVICE_OAUTH_INITIAL_POLL_DELAY_MS = 1_000;
const DEVICE_OAUTH_FAST_POLL_DELAY_MS = 1_500;
const DEVICE_OAUTH_FAST_POLL_WINDOW_MS = 15_000;
const WEB_AUTH_TOKEN_STORAGE_KEY = "aura-start-google-web-auth-token";
const DEVICE_AUTH_TOKEN_STORAGE_KEY = "aura-start-google-device-auth-token";
export const GOOGLE_DEVICE_AUTH_EVENT = "aura-start:google-device-auth";
const FIREFOX_DRIVE_SYNC_DATA_COLLECTION_PERMISSIONS: ExtensionDataCollectionPermission[] = [
  "browsingActivity",
  "technicalAndInteraction"
];
const OAUTH_CLIENT_ID_PATTERN = /^[a-z0-9-]+\.apps\.googleusercontent\.com$/i;
const WEB_OAUTH_FALLBACK_ENABLED =
  typeof __AURA_ENABLE_GOOGLE_WEB_OAUTH_FALLBACK__ === "boolean"
    ? __AURA_ENABLE_GOOGLE_WEB_OAUTH_FALLBACK__
    : false;
const WEB_OAUTH_CLIENT_ID =
  WEB_OAUTH_FALLBACK_ENABLED && typeof __AURA_GOOGLE_WEB_OAUTH_CLIENT_ID__ === "string"
    ? __AURA_GOOGLE_WEB_OAUTH_CLIENT_ID__.trim()
    : "";
const WEB_OAUTH_REDIRECT_PATH =
  WEB_OAUTH_FALLBACK_ENABLED && typeof __AURA_GOOGLE_WEB_OAUTH_REDIRECT_PATH__ === "string"
    ? __AURA_GOOGLE_WEB_OAUTH_REDIRECT_PATH__.trim()
    : "";
const DEVICE_OAUTH_FALLBACK_ENABLED =
  typeof __AURA_ENABLE_GOOGLE_DEVICE_OAUTH_FALLBACK__ === "boolean"
    ? __AURA_ENABLE_GOOGLE_DEVICE_OAUTH_FALLBACK__
    : false;
const DEVICE_OAUTH_CLIENT_ID =
  DEVICE_OAUTH_FALLBACK_ENABLED && typeof __AURA_GOOGLE_DEVICE_OAUTH_CLIENT_ID__ === "string"
    ? __AURA_GOOGLE_DEVICE_OAUTH_CLIENT_ID__.trim()
    : "";
const DEVICE_OAUTH_CLIENT_SECRET =
  DEVICE_OAUTH_FALLBACK_ENABLED && typeof __AURA_GOOGLE_DEVICE_OAUTH_CLIENT_SECRET__ === "string"
    ? __AURA_GOOGLE_DEVICE_OAUTH_CLIENT_SECRET__.trim()
    : "";
const TARGET_BROWSER =
  typeof __AURA_TARGET_BROWSER__ === "string"
    ? __AURA_TARGET_BROWSER__.trim().toLowerCase()
    : "chromium";
type RecordValue = Record<string, unknown>;
type ManifestWithOAuth = chrome.runtime.Manifest & {
  oauth2?: {
    client_id?: string;
    scopes?: string[];
  };
  update_url?: string;
};
type CachedToken = {
  token: string;
  expiresAt: number;
};
type CachedDeviceToken = CachedToken & {
  refreshToken: string;
};
type GoogleDriveStorageMode = "app_data_folder" | "drive_file";

export type GoogleDeviceAuthEventDetail = {
  userCode: string;
  verificationUrl: string;
  verificationUrlComplete?: string;
  expiresAt: number;
};

export type GoogleDriveAuthFlow = "chrome_identity" | "device_oauth" | "web_oauth" | "unavailable";
export type GoogleDriveBrowserOAuthCapability = "chrome_identity" | "web_oauth";
export type GoogleDriveTargetBrowser = "chromium" | "firefox";
export type GoogleDriveChromiumVariant =
  | "google_chrome"
  | "chromium"
  | "ungoogled_chromium"
  | "chromium_fork"
  | "unknown";
export type GoogleDriveInstallSource = "chrome_web_store" | "unpacked" | "unknown";

export type GoogleDriveAuthFlowInput = {
  hasIdentityApi: boolean;
  hasGetAuthToken: boolean;
  manifestClientId?: string;
  manifestScopes?: string[];
  chromeIdentityUnsupported?: boolean;
  installSource?: GoogleDriveInstallSource;
  deviceOAuthClientId?: string;
  deviceOAuthClientSecret?: string;
  webOAuthClientId?: string;
  targetBrowser?: GoogleDriveTargetBrowser;
};

type GoogleApiErrorDetail = {
  domain?: string;
  message?: string;
  reason?: string;
};

type GoogleApiErrorBody = {
  error?: {
    code?: number;
    details?: unknown[];
    errors?: GoogleApiErrorDetail[];
    message?: string;
    status?: string;
  };
};

export type GoogleDriveErrorCode =
  | "auth_cancelled"
  | "identity_unavailable"
  | "network"
  | "not_found"
  | "rate_limited"
  | "unauthorized"
  | "forbidden"
  | "invalid_cloud_file"
  | "unknown";

export type GoogleDriveFileMetadata = {
  id: string;
  name: string;
  modifiedTime?: string;
  size?: string;
};

export type GoogleDriveSyncPayload = {
  schemaVersion: 1;
  app: "Aura Start";
  appVersion: string;
  updatedAt: string;
  deviceId: string;
  data: AuraStartData;
};

export type GoogleDriveSyncDownload = {
  metadata: GoogleDriveFileMetadata;
  payload: GoogleDriveSyncPayload;
  data: AuraStartData;
  cloudUpdatedAt: string;
};

export type GoogleDriveComparison =
  | "no_cloud_file"
  | "in_sync"
  | "local_newer"
  | "cloud_newer"
  | "conflict";

export class GoogleDriveSyncError extends Error {
  code: GoogleDriveErrorCode;
  reason?: string;
  status?: number;

  constructor(code: GoogleDriveErrorCode, message: string, status?: number, reason?: string) {
    super(message);
    this.name = "GoogleDriveSyncError";
    this.code = code;
    this.reason = reason;
    this.status = status;
  }
}

let webAuthTokenCache: CachedToken | undefined;
let deviceAuthTokenCache: CachedDeviceToken | undefined;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireIdentityApi(): void {
  if (!hasExtensionIdentityApi()) {
    throw new GoogleDriveSyncError(
      "identity_unavailable",
      "Google Drive sync is available only inside the installed browser extension."
    );
  }
}

function appVersion(): string {
  return getAuraStartVersion();
}

function looksLikeExampleOAuthClientId(clientId: string): boolean {
  const normalized = clientId.toLowerCase();
  return normalized.includes("your_google_oauth_client_id")
    || normalized.includes("your-real-client-id")
    || normalized.includes("paste_real_client_id_here")
    || normalized.includes("placeholder")
    || normalized.includes("example")
    || /^123(?:4567890)?-[a-z]+\.apps\.googleusercontent\.com$/i.test(normalized);
}

function isUsableOAuthClientId(clientId: string | undefined): boolean {
  return Boolean(
    clientId
      && OAUTH_CLIENT_ID_PATTERN.test(clientId)
      && !looksLikeExampleOAuthClientId(clientId)
  );
}

function hasExactDriveAppDataScope(scopes: string[] | undefined): boolean {
  return Array.isArray(scopes) && scopes.length === 1 && scopes[0] === DRIVE_APPDATA_SCOPE;
}

export function selectGoogleDriveAuthFlow(input: GoogleDriveAuthFlowInput): GoogleDriveAuthFlow {
  const canUseDeviceOAuth = isUsableOAuthClientId(input.deviceOAuthClientId)
    && Boolean(input.deviceOAuthClientSecret?.trim());
  const canUseWebOAuth = input.hasIdentityApi && isUsableOAuthClientId(input.webOAuthClientId);
  const fallbackFlow: GoogleDriveAuthFlow = canUseDeviceOAuth
    ? "device_oauth"
    : canUseWebOAuth
      ? "web_oauth"
      : "unavailable";

  if (input.targetBrowser === "firefox") {
    return fallbackFlow;
  }

  if (input.installSource === "chrome_web_store") {
    if (input.chromeIdentityUnsupported || !input.hasGetAuthToken) {
      return fallbackFlow;
    }

    return input.hasIdentityApi
      && input.hasGetAuthToken
      && isUsableOAuthClientId(input.manifestClientId)
      && hasExactDriveAppDataScope(input.manifestScopes)
      ? "chrome_identity"
      : "unavailable";
  }

  // Unpacked builds usually have a different extension ID than the published
  // Chrome Web Store item, so the manifest Chrome Extension OAuth client may
  // not be authorized for that local ID. Prefer an explicit redirect-free
  // Device OAuth fallback when it is configured.
  if (input.installSource === "unpacked" && fallbackFlow !== "unavailable") {
    return fallbackFlow;
  }

  if (input.chromeIdentityUnsupported) {
    return fallbackFlow;
  }

  if (input.hasIdentityApi && input.hasGetAuthToken) {
    return isUsableOAuthClientId(input.manifestClientId) && hasExactDriveAppDataScope(input.manifestScopes)
      ? "chrome_identity"
      : "unavailable";
  }

  return fallbackFlow;
}

function isChromeExtensionId(value: string | undefined): boolean {
  return typeof value === "string" && /^[a-p]{32}$/.test(value);
}

function isChromeWebStoreUpdateUrl(value: string): boolean {
  return /(?:^|\/\/)clients2\.google\.com\/service\/update2\/crx/i.test(value);
}

export function detectGoogleDriveInstallSource(): GoogleDriveInstallSource {
  const extensionId = getExtensionRuntimeId()?.trim() ?? "";
  if (!extensionId) {
    return "unknown";
  }

  const manifest = getExtensionManifest() as ManifestWithOAuth | undefined;
  const updateUrl = typeof manifest?.update_url === "string" ? manifest.update_url.trim() : "";

  if (
    extensionId === PUBLISHED_CHROME_WEB_STORE_EXTENSION_ID
    || isChromeWebStoreUpdateUrl(updateUrl)
  ) {
    return "chrome_web_store";
  }

  if (!isChromeExtensionId(extensionId)) {
    return "unknown";
  }

  return updateUrl ? "unknown" : "unpacked";
}

type NavigatorWithBrave = Navigator & {
  brave?: {
    isBrave?: () => Promise<boolean>;
  };
  userAgentData?: {
    brands?: Array<{ brand?: string; version?: string }>;
    getHighEntropyValues?: (hints: string[]) => Promise<{
      brands?: Array<{ brand?: string; version?: string }>;
      fullVersionList?: Array<{ brand?: string; version?: string }>;
      platform?: string;
      platformVersion?: string;
      uaFullVersion?: string;
    }>;
  };
};

function chromiumVariantOAuthCapability(variant: GoogleDriveChromiumVariant): GoogleDriveBrowserOAuthCapability {
  return variant === "google_chrome" ? "chrome_identity" : "web_oauth";
}

export async function detectGoogleDriveChromiumVariant(): Promise<GoogleDriveChromiumVariant> {
  const userAgent = globalThis.navigator?.userAgent ?? "";
  const vendor = globalThis.navigator?.vendor ?? "";
  const userAgentData = (globalThis.navigator as NavigatorWithBrave | undefined)?.userAgentData;
  const lowEntropyBrands = userAgentData?.brands ?? [];
  const highEntropy = typeof userAgentData?.getHighEntropyValues === "function"
    ? await userAgentData.getHighEntropyValues(["brands", "fullVersionList", "platform", "uaFullVersion"]).catch(() => undefined)
    : undefined;
  const highEntropyBrands = [...(highEntropy?.brands ?? []), ...(highEntropy?.fullVersionList ?? [])];
  const brands = [...lowEntropyBrands, ...highEntropyBrands];
  const brandText = brands.map((brand) => brand.brand ?? "").join(" ");
  const browserText = `${userAgent} ${brandText}`;
  const hasGoogleChromeBrand = /\bGoogle Chrome\b/i.test(brandText);
  const hasChromiumBrand = /\bChromium\b/i.test(browserText);
  const hasChromeUserAgent = /\bChrome\/\d/i.test(userAgent);
  const googleVendor = vendor === "Google Inc.";

  if (/\b(Helium|Ungoogled|ungoogled[-\s]?chromium|Cromite|Iridium)\b/i.test(browserText)) {
    return "ungoogled_chromium";
  }

  if (/\b(Brave|Edg|OPR|Opera|Vivaldi|YaBrowser|Yandex|Arc|Thorium)\b/i.test(browserText)) {
    return "chromium_fork";
  }

  const brave = (globalThis.navigator as NavigatorWithBrave | undefined)?.brave;
  if (typeof brave?.isBrave === "function" && await brave.isBrave().catch(() => false)) {
    return "chromium_fork";
  }

  if (hasGoogleChromeBrand) {
    return "google_chrome";
  }

  // Plain Chromium and de-Googled Chromium variants often do not have Chrome's
  // Google account token service even when they can install Chrome extensions.
  if (hasChromiumBrand) {
    return "chromium";
  }

  if (hasChromeUserAgent) {
    // Some Chromium browsers expose a Chrome-like user agent and Google vendor
    // but do not support Chrome's Google account token service. Treat that as
    // ambiguous unless userAgentData explicitly reported the Google Chrome
    // brand above, so Drive sync uses the redirect-free fallback instead.
    return googleVendor ? "unknown" : "chromium_fork";
  }

  return "unknown";
}

export async function detectGoogleDriveBrowserOAuthCapability(): Promise<GoogleDriveBrowserOAuthCapability> {
  const variant = await detectGoogleDriveChromiumVariant();
  return chromiumVariantOAuthCapability(variant);
}

async function detectChromeIdentitySupport(): Promise<boolean> {
  if (!hasExtensionIdentityGetAuthToken()) {
    return false;
  }

  try {
    await getChromeAuthToken(false, CHROME_IDENTITY_PROBE_TIMEOUT_MS);
    return true;
  } catch (error) {
    return !isChromeIdentityUnsupportedError(error);
  }
}

async function detectInteractiveChromeIdentityUnsupported(variant: GoogleDriveChromiumVariant): Promise<boolean> {
  if (chromiumVariantOAuthCapability(variant) === "web_oauth") {
    return true;
  }

  return !await detectChromeIdentitySupport();
}

async function detectInteractiveAuthContext(): Promise<{
  browserOAuthCapability: GoogleDriveBrowserOAuthCapability;
  chromiumVariant: GoogleDriveChromiumVariant;
  chromeIdentityUnsupported: boolean;
}> {
  const chromiumVariant = await detectGoogleDriveChromiumVariant();
  const browserOAuthCapability = chromiumVariantOAuthCapability(chromiumVariant);
  const chromeIdentityUnsupported = await detectInteractiveChromeIdentityUnsupported(chromiumVariant);
  return {
    browserOAuthCapability,
    chromiumVariant,
    chromeIdentityUnsupported
  };
}

async function detectNonInteractiveAuthContext(): Promise<{
  browserOAuthCapability: GoogleDriveBrowserOAuthCapability;
  chromiumVariant: GoogleDriveChromiumVariant;
  chromeIdentityUnsupported: boolean;
}> {
  const chromiumVariant = await detectGoogleDriveChromiumVariant();
  const browserOAuthCapability = chromiumVariantOAuthCapability(chromiumVariant);
  return {
    browserOAuthCapability,
    chromiumVariant,
    chromeIdentityUnsupported: browserOAuthCapability === "web_oauth"
  };
}

function chromeIdentityTimeoutError(): GoogleDriveSyncError {
  return new GoogleDriveSyncError(
    "identity_unavailable",
    "Chrome identity sign-in did not respond in this Chromium browser."
  );
}

export function webOAuthRedirectPath(): string {
  if (WEB_OAUTH_REDIRECT_PATH) {
    return WEB_OAUTH_REDIRECT_PATH;
  }

  // Use Chrome's canonical extension redirect URL by default:
  // https://<extension-id>.chromiumapp.org/
  // Google Web OAuth matching is strict, so Google Cloud must contain this
  // exact URI, including the trailing slash, for the Web OAuth client.
  return "";
}

function normalizeWebOAuthRedirectPath(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, "");
}

function isChromiumAppRedirectUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /\.chromiumapp\.org$/i.test(url.hostname);
  } catch {
    return false;
  }
}

export function fallbackChromiumAppRedirectUrl(path: string): string | undefined {
  const extensionId = getExtensionRuntimeId();
  if (!extensionId) {
    return undefined;
  }

  const normalizedPath = normalizeWebOAuthRedirectPath(path);
  return `https://${extensionId}.chromiumapp.org/${normalizedPath}`;
}

function webOAuthRedirectUri(path: string): string {
  const normalizedPath = normalizeWebOAuthRedirectPath(path);
  const browserRedirectUrl = getExtensionRedirectUrl(normalizedPath);
  if (!browserRedirectUrl) {
    throw new GoogleDriveSyncError(
      "identity_unavailable",
      "This browser does not support the Google OAuth redirect URL required for Drive sync."
    );
  }
  if (isChromiumAppRedirectUrl(browserRedirectUrl)) {
    return browserRedirectUrl;
  }

  return fallbackChromiumAppRedirectUrl(normalizedPath) ?? browserRedirectUrl;
}

function oauthClientConfigurationError(clientId: string | undefined): string {
  if (!clientId) {
    return "Google Drive sync is not configured in this build. Rebuild Aura Start so the generated manifest contains a real Chrome Extension OAuth Client ID.";
  }

  if (!OAUTH_CLIENT_ID_PATTERN.test(clientId)) {
    return "Google Drive sync is not configured correctly. The OAuth Client ID in the generated manifest must end with .apps.googleusercontent.com.";
  }

  if (looksLikeExampleOAuthClientId(clientId)) {
    return "Google Drive sync is using an example OAuth Client ID, so Google rejects it with invalid_client. Rebuild Aura Start with a real Chrome Extension OAuth Client ID from Google Cloud Console.";
  }

  return "Google Drive sync is not configured correctly. Rebuild Aura Start with a real Google OAuth Client ID.";
}

function manifestOAuthConfig(): { clientId?: string; scopes?: string[] } {
  const manifest = getExtensionManifest() as ManifestWithOAuth | undefined;
  return {
    clientId: manifest?.oauth2?.client_id?.trim(),
    scopes: manifest?.oauth2?.scopes?.filter((scope) => typeof scope === "string" && scope.trim())
  };
}

function manifestOAuthConfigurationError(config: { clientId?: string; scopes?: string[] }): string {
  if (!isUsableOAuthClientId(config.clientId)) {
    return oauthClientConfigurationError(config.clientId);
  }

  if (!hasExactDriveAppDataScope(config.scopes)) {
    return "Google Drive sync is not configured correctly. The extension manifest must request only the Google Drive appDataFolder OAuth scope.";
  }

  return "Google Drive sync is not configured correctly. Rebuild Aura Start with a valid Google OAuth manifest configuration.";
}

function configuredWebOAuthClientId(): string | undefined {
  return WEB_OAUTH_CLIENT_ID
    && OAUTH_CLIENT_ID_PATTERN.test(WEB_OAUTH_CLIENT_ID)
    && !looksLikeExampleOAuthClientId(WEB_OAUTH_CLIENT_ID)
    ? WEB_OAUTH_CLIENT_ID
    : undefined;
}

function configuredDeviceOAuthClient(): { clientId: string; clientSecret: string } | undefined {
  return DEVICE_OAUTH_CLIENT_ID
    && DEVICE_OAUTH_CLIENT_SECRET
    && OAUTH_CLIENT_ID_PATTERN.test(DEVICE_OAUTH_CLIENT_ID)
    && !looksLikeExampleOAuthClientId(DEVICE_OAUTH_CLIENT_ID)
    ? { clientId: DEVICE_OAUTH_CLIENT_ID, clientSecret: DEVICE_OAUTH_CLIENT_SECRET }
    : undefined;
}

function oauthScopes(): string[] {
  const manifest = getExtensionManifest() as ManifestWithOAuth | undefined;
  const scopes = manifest?.oauth2?.scopes?.filter((scope) => typeof scope === "string" && scope.trim());
  return scopes?.length ? scopes : [DRIVE_APPDATA_SCOPE];
}

export function googleDriveDeviceOAuthScopes(): string[] {
  return [DEVICE_OAUTH_DRIVE_SCOPE];
}

function storageModeForToken(token: string): GoogleDriveStorageMode {
  return deviceAuthTokenCache?.token === token ? "drive_file" : "app_data_folder";
}

function cachedWebAuthToken(): string | undefined {
  if (!webAuthTokenCache) return undefined;
  if (Date.now() + TOKEN_EXPIRY_SAFETY_MS >= webAuthTokenCache.expiresAt) {
    webAuthTokenCache = undefined;
    return undefined;
  }

  return webAuthTokenCache.token;
}

function normalizeCachedToken(value: unknown): CachedToken | undefined {
  if (!isRecord(value) || typeof value.token !== "string" || typeof value.expiresAt !== "number") {
    return undefined;
  }

  if (Date.now() + TOKEN_EXPIRY_SAFETY_MS >= value.expiresAt) {
    return undefined;
  }

  return {
    token: value.token,
    expiresAt: value.expiresAt
  };
}

function authTokenStorageAreas(): ExtensionStorageArea[] {
  const areas: ExtensionStorageArea[] = [];
  const local = getExtensionStorageArea("local");
  const session = getExtensionStorageArea("session");
  if (local) {
    areas.push(local);
  }
  if (session) {
    areas.push(session);
  }
  return areas;
}

function webAuthTokenStorageAreas(): ExtensionStorageArea[] {
  return authTokenStorageAreas();
}

function deviceAuthTokenStorageAreas(): ExtensionStorageArea[] {
  return authTokenStorageAreas();
}

async function readStoredWebAuthToken(): Promise<string | undefined> {
  for (const area of webAuthTokenStorageAreas()) {
    const result = await area.get(WEB_AUTH_TOKEN_STORAGE_KEY).catch(() => undefined);
    const cached = result ? normalizeCachedToken(result[WEB_AUTH_TOKEN_STORAGE_KEY]) : undefined;
    if (!cached) {
      await area.remove(WEB_AUTH_TOKEN_STORAGE_KEY).catch(() => undefined);
      continue;
    }

    webAuthTokenCache = cached;
    return cached.token;
  }

  return undefined;
}

async function writeStoredWebAuthToken(token: CachedToken): Promise<void> {
  await Promise.all(
    webAuthTokenStorageAreas().map((area) => area.set({ [WEB_AUTH_TOKEN_STORAGE_KEY]: token }).catch(() => undefined))
  );
}

async function removeStoredWebAuthToken(): Promise<void> {
  await Promise.all(webAuthTokenStorageAreas().map((area) => area.remove(WEB_AUTH_TOKEN_STORAGE_KEY).catch(() => undefined)));
}

function normalizeCachedDeviceToken(value: unknown): CachedDeviceToken | undefined {
  if (!isRecord(value) || typeof value.token !== "string" || typeof value.refreshToken !== "string" || typeof value.expiresAt !== "number") {
    return undefined;
  }

  return {
    token: value.token,
    refreshToken: value.refreshToken,
    expiresAt: value.expiresAt
  };
}

async function readStoredDeviceAuthToken(): Promise<CachedDeviceToken | undefined> {
  for (const area of deviceAuthTokenStorageAreas()) {
    const result = await area.get(DEVICE_AUTH_TOKEN_STORAGE_KEY).catch(() => undefined);
    const cached = result ? normalizeCachedDeviceToken(result[DEVICE_AUTH_TOKEN_STORAGE_KEY]) : undefined;
    if (!cached) {
      await area.remove(DEVICE_AUTH_TOKEN_STORAGE_KEY).catch(() => undefined);
      continue;
    }

    deviceAuthTokenCache = cached;
    return cached;
  }

  return undefined;
}

async function writeStoredDeviceAuthToken(token: CachedDeviceToken): Promise<void> {
  await Promise.all(
    deviceAuthTokenStorageAreas().map((area) => area.set({ [DEVICE_AUTH_TOKEN_STORAGE_KEY]: token }).catch(() => undefined))
  );
}

async function removeStoredDeviceAuthToken(): Promise<void> {
  deviceAuthTokenCache = undefined;
  await Promise.all(deviceAuthTokenStorageAreas().map((area) => area.remove(DEVICE_AUTH_TOKEN_STORAGE_KEY).catch(() => undefined)));
}

async function getCachedWebAuthToken(): Promise<string | undefined> {
  return cachedWebAuthToken() ?? await readStoredWebAuthToken();
}

async function getCachedDeviceAuthToken(): Promise<CachedDeviceToken | undefined> {
  if (deviceAuthTokenCache) {
    return deviceAuthTokenCache;
  }

  return await readStoredDeviceAuthToken();
}

function isCachedAccessTokenUsable(cached: CachedToken): boolean {
  return Date.now() + TOKEN_EXPIRY_SAFETY_MS < cached.expiresAt;
}

async function getCachedWebAuthTokenBeforeLaunch(interactive: boolean): Promise<string | undefined> {
  const cached = cachedWebAuthToken();
  if (cached || interactive) {
    return cached;
  }

  return await readStoredWebAuthToken();
}

async function getNonInteractiveCachedToken(): Promise<string | undefined> {
  const installSource = detectGoogleDriveInstallSource();
  const deviceOAuthClient = configuredDeviceOAuthClient();
  if (deviceOAuthClient) {
    const cachedDeviceToken = await getDeviceAuthToken(false).catch(() => undefined);
    if (cachedDeviceToken) {
      return cachedDeviceToken;
    }
  }

  const webOAuthClientId = configuredWebOAuthClientId();
  if (webOAuthClientId) {
    const cachedWebToken = await getCachedWebAuthToken();
    if (cachedWebToken) {
      return cachedWebToken;
    }
  }

  const { chromeIdentityUnsupported } = await detectNonInteractiveAuthContext();
  const manifestConfig = manifestOAuthConfig();
  const flow = selectGoogleDriveAuthFlow({
    hasIdentityApi: hasExtensionIdentityApi(),
    hasGetAuthToken: hasExtensionIdentityGetAuthToken(),
    manifestClientId: manifestConfig.clientId,
    manifestScopes: manifestConfig.scopes,
    chromeIdentityUnsupported,
    installSource,
    deviceOAuthClientId: deviceOAuthClient?.clientId,
    deviceOAuthClientSecret: deviceOAuthClient?.clientSecret,
    webOAuthClientId,
    targetBrowser: TARGET_BROWSER === "firefox" ? "firefox" : "chromium"
  });

  if (flow === "device_oauth") {
    return await getDeviceAuthToken(false).catch(() => undefined);
  }

  if (flow === "web_oauth") {
    return await getCachedWebAuthToken();
  }

  if (flow === "chrome_identity") {
    return await getChromeAuthToken(false, CHROME_IDENTITY_PROBE_TIMEOUT_MS).catch(() => undefined);
  }

  return undefined;
}

function randomState(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") {
    return randomUUID.call(globalThis.crypto);
  }

  const values = new Uint32Array(4);
  globalThis.crypto?.getRandomValues(values);
  return Array.from(values, (value) => value.toString(36)).join("");
}

function authResultToken(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (isRecord(value) && typeof value.token === "string") {
    return value.token;
  }

  return undefined;
}

function isBrowserSigninDisabledError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("browser signin") || message.includes("browser sign-in");
}

export function isChromeIdentityUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return isBrowserSigninDisabledError(error)
    || message.includes("did not respond")
    || message.includes("custom uri scheme")
    || message.includes("not supported on chrome apps");
}

async function getChromeAuthToken(interactive: boolean, timeoutMs?: number): Promise<string> {
  requireIdentityApi();
  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    const timeout = timeoutMs && timeoutMs > 0
      ? globalThis.setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(chromeIdentityTimeoutError());
        }, timeoutMs)
      : undefined;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timeout) {
        globalThis.clearTimeout(timeout);
      }
      callback();
    };

    void getExtensionAuthToken(interactive)
      .then((token) => {
        const resolvedToken = authResultToken(token);
        if (!resolvedToken) {
          finish(() => reject(new GoogleDriveSyncError("auth_cancelled", "Google authorization did not return a token.")));
          return;
        }

        finish(() => resolve(resolvedToken));
      })
      .catch((error) => {
        finish(() => reject(new GoogleDriveSyncError("auth_cancelled", error instanceof Error ? error.message : "Google authorization failed.")));
      });
  });
}

async function launchGoogleWebAuthFlow(interactive: boolean): Promise<string> {
  const clientId = configuredWebOAuthClientId();
  if (!clientId) {
    throw new GoogleDriveSyncError(
      "identity_unavailable",
      "This build uses Chrome's built-in Google sign-in for Drive sync. The Web OAuth fallback is not configured."
    );
  }

  const cached = await getCachedWebAuthTokenBeforeLaunch(interactive);
  if (cached) {
    return cached;
  }

  requireIdentityApi();
  if (!hasExtensionWebAuthFlow()) {
    throw new GoogleDriveSyncError(
      "identity_unavailable",
      "This browser does not support the Google OAuth web auth flow required for Drive sync."
    );
  }

  const redirectUri = webOAuthRedirectUri(webOAuthRedirectPath());
  const state = randomState();
  const authUrl = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "token");
  authUrl.searchParams.set("scope", oauthScopes().join(" "));
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("state", state);
  if (interactive) {
    authUrl.searchParams.set("prompt", "select_account consent");
  }

  const redirectResult = await launchExtensionWebAuthFlow({ interactive, url: authUrl.toString() })
    .catch((error) => {
      throw new GoogleDriveSyncError(
        "auth_cancelled",
        error instanceof Error ? error.message : "Google authorization did not complete."
      );
    });

  const redirectedUrl = new URL(redirectResult);
  const fragmentParams = new URLSearchParams(redirectedUrl.hash.startsWith("#") ? redirectedUrl.hash.slice(1) : "");
  const queryParams = redirectedUrl.searchParams;
  const params = fragmentParams.size ? fragmentParams : queryParams;
  const error = params.get("error");
  if (error) {
    throw new GoogleDriveSyncError("auth_cancelled", params.get("error_description") ?? error);
  }

  if (params.get("state") !== state) {
    throw new GoogleDriveSyncError("auth_cancelled", "Google authorization returned an invalid state.");
  }

  const token = params.get("access_token");
  if (!token) {
    throw new GoogleDriveSyncError("auth_cancelled", "Google authorization did not return an access token.");
  }

  const expiresInSeconds = Number(params.get("expires_in") ?? "3600");
  const expiresIn = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds : 3600;
  const cachedToken = {
    token,
    expiresAt: Date.now() + expiresIn * 1000
  };
  webAuthTokenCache = cachedToken;
  await writeStoredWebAuthToken(cachedToken);

  return token;
}

type GoogleDeviceCodeResponse = {
  device_code?: string;
  user_code?: string;
  verification_url?: string;
  verification_url_complete?: string;
  expires_in?: number;
  interval?: number;
  error?: string;
  error_description?: string;
};

type GoogleDeviceTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

async function readGoogleOAuthJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => undefined);
  return (isRecord(body) ? body : {}) as T;
}

async function requestGoogleDeviceCode(clientId: string): Promise<Required<Pick<GoogleDeviceCodeResponse, "device_code" | "user_code" | "verification_url">> & {
  verification_url_complete?: string;
  expires_in: number;
  interval: number;
}> {
  const scopes = googleDriveDeviceOAuthScopes();
  if (scopes.includes(DRIVE_APPDATA_SCOPE)) {
    throw new GoogleDriveSyncError(
      "identity_unavailable",
      "Google Device OAuth cannot request the appDataFolder scope. Rebuild Aura Start with the device-code Drive file scope."
    );
  }

  const body = new URLSearchParams({
    client_id: clientId,
    scope: scopes.join(" ")
  });
  const response = await fetch(GOOGLE_DEVICE_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const json = await readGoogleOAuthJson<GoogleDeviceCodeResponse>(response);

  if (!response.ok || !json.device_code || !json.user_code || !json.verification_url) {
    throw new GoogleDriveSyncError(
      response.status === 403 ? "forbidden" : "identity_unavailable",
      json.error_description ?? json.error ?? "Google Device OAuth could not create a sign-in code.",
      response.status,
      json.error
    );
  }

  return {
    device_code: json.device_code,
    user_code: json.user_code,
    verification_url: json.verification_url,
    verification_url_complete: json.verification_url_complete,
    expires_in: Number.isFinite(json.expires_in) && Number(json.expires_in) > 0 ? Number(json.expires_in) : 1800,
    interval: Number.isFinite(json.interval) && Number(json.interval) > 0 ? Number(json.interval) : 5
  };
}

function emitGoogleDeviceAuthEvent(detail: GoogleDeviceAuthEventDetail): void {
  globalThis.dispatchEvent?.(new CustomEvent<GoogleDeviceAuthEventDetail>(GOOGLE_DEVICE_AUTH_EVENT, { detail }));
}

export function googleDriveDeviceOAuthPollDelayMs(input: {
  firstPoll: boolean;
  recommendedIntervalMs: number;
  startedAt: number;
  now: number;
  slowedDown: boolean;
}): number {
  const recommendedIntervalMs = Math.max(input.recommendedIntervalMs, DEVICE_OAUTH_INITIAL_POLL_DELAY_MS);
  if (input.slowedDown) {
    return recommendedIntervalMs;
  }

  if (input.firstPoll) {
    return Math.min(DEVICE_OAUTH_INITIAL_POLL_DELAY_MS, recommendedIntervalMs);
  }

  if (input.now - input.startedAt <= DEVICE_OAUTH_FAST_POLL_WINDOW_MS) {
    return Math.min(DEVICE_OAUTH_FAST_POLL_DELAY_MS, recommendedIntervalMs);
  }

  return recommendedIntervalMs;
}

function openGoogleDeviceVerificationPage(url: string): void {
  void createExtensionTab({ url });
}

function deviceTokenFromResponse(json: GoogleDeviceTokenResponse, fallbackRefreshToken?: string): CachedDeviceToken {
  if (!json.access_token) {
    throw new GoogleDriveSyncError("auth_cancelled", "Google Device OAuth did not return an access token.");
  }

  const refreshToken = json.refresh_token ?? fallbackRefreshToken;
  if (!refreshToken) {
    throw new GoogleDriveSyncError("auth_cancelled", "Google Device OAuth did not return a refresh token.");
  }

  const expiresInSeconds = Number(json.expires_in ?? "3600");
  const expiresIn = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds : 3600;
  return {
    token: json.access_token,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000
  };
}

async function exchangeGoogleDeviceCode(
  client: { clientId: string; clientSecret: string },
  deviceCode: string
): Promise<CachedDeviceToken | "authorization_pending" | "slow_down"> {
  const body = new URLSearchParams({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code"
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const json = await readGoogleOAuthJson<GoogleDeviceTokenResponse>(response);

  if (response.ok) {
    return deviceTokenFromResponse(json);
  }

  if (json.error === "authorization_pending") {
    return "authorization_pending";
  }

  if (json.error === "slow_down") {
    return "slow_down";
  }

  if (json.error === "access_denied") {
    throw new GoogleDriveSyncError("auth_cancelled", json.error_description ?? "Google Device OAuth access was denied.", response.status, json.error);
  }

  throw new GoogleDriveSyncError(
    response.status === 401 ? "unauthorized" : "identity_unavailable",
    json.error_description ?? json.error ?? "Google Device OAuth token exchange failed.",
    response.status,
    json.error
  );
}

async function refreshGoogleDeviceToken(
  client: { clientId: string; clientSecret: string },
  refreshToken: string
): Promise<CachedDeviceToken> {
  const body = new URLSearchParams({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const json = await readGoogleOAuthJson<GoogleDeviceTokenResponse>(response);

  if (!response.ok) {
    if (json.error === "invalid_grant" || response.status === 401) {
      await removeStoredDeviceAuthToken();
    }
    throw new GoogleDriveSyncError(
      response.status === 401 ? "unauthorized" : "identity_unavailable",
      json.error_description ?? json.error ?? "Google Device OAuth refresh failed.",
      response.status,
      json.error
    );
  }

  return deviceTokenFromResponse(json, refreshToken);
}

async function getDeviceAuthToken(interactive: boolean): Promise<string> {
  const client = configuredDeviceOAuthClient();
  if (!client) {
    throw new GoogleDriveSyncError(
      "identity_unavailable",
      "This build does not include the Google Device OAuth fallback required by this browser."
    );
  }

  const cached = await getCachedDeviceAuthToken();
  if (cached) {
    if (isCachedAccessTokenUsable(cached)) {
      return cached.token;
    }

    const refreshed = await refreshGoogleDeviceToken(client, cached.refreshToken);
    deviceAuthTokenCache = refreshed;
    await writeStoredDeviceAuthToken(refreshed);
    return refreshed.token;
  }

  if (!interactive) {
    throw new GoogleDriveSyncError("unauthorized", "Google Drive needs sign-in to continue syncing.");
  }

  const code = await requestGoogleDeviceCode(client.clientId);
  const verificationUrl = code.verification_url_complete ?? code.verification_url;
  emitGoogleDeviceAuthEvent({
    userCode: code.user_code,
    verificationUrl: code.verification_url,
    verificationUrlComplete: code.verification_url_complete,
    expiresAt: Date.now() + code.expires_in * 1000
  });
  openGoogleDeviceVerificationPage(verificationUrl);

  let intervalMs = Math.max(code.interval, 5) * 1000;
  const startedAt = Date.now();
  const expiresAt = Date.now() + code.expires_in * 1000;
  let firstPoll = true;
  let slowedDown = false;
  while (Date.now() < expiresAt) {
    const now = Date.now();
    const delayMs = Math.min(
      googleDriveDeviceOAuthPollDelayMs({
        firstPoll,
        recommendedIntervalMs: intervalMs,
        startedAt,
        now,
        slowedDown
      }),
      Math.max(expiresAt - now, 0)
    );
    await new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
    firstPoll = false;
    const result = await exchangeGoogleDeviceCode(client, code.device_code);
    if (result === "authorization_pending") {
      continue;
    }
    if (result === "slow_down") {
      slowedDown = true;
      intervalMs += 5000;
      continue;
    }

    deviceAuthTokenCache = result;
    await writeStoredDeviceAuthToken(result);
    return result.token;
  }

  throw new GoogleDriveSyncError("auth_cancelled", "Google Device OAuth code expired before sign-in completed.");
}

function driveHeaders(token: string, extra?: HeadersInit): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    ...extra
  };
}

function statusCodeToErrorCode(status: number): GoogleDriveErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  return "unknown";
}

async function errorFromResponse(response: Response): Promise<GoogleDriveSyncError> {
  let message = response.statusText || "Google Drive request failed.";
  let reason: string | undefined;
  try {
    const body = await response.json() as GoogleApiErrorBody;
    message = body.error?.message ?? message;
    reason = body.error?.errors?.find((item) => item.reason)?.reason ?? body.error?.status;
  } catch {
    // Keep the HTTP status text when Google returns a non-JSON error body.
  }

  return new GoogleDriveSyncError(statusCodeToErrorCode(response.status), message, response.status, reason);
}

async function driveFetch<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: driveHeaders(token, init.headers)
    });
  } catch (error) {
    throw new GoogleDriveSyncError(
      "network",
      error instanceof Error ? error.message : "Network connection failed."
    );
  }

  if (!response.ok) {
    throw await errorFromResponse(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return await response.json() as T;
}

function createMultipartBody(metadata: RecordValue, payload: GoogleDriveSyncPayload): {
  body: string;
  contentType: string;
} {
  const boundary = `aura_start_${Math.random().toString(36).slice(2)}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(payload, null, 2),
    `--${boundary}--`,
    ""
  ].join("\r\n");

  return {
    body,
    contentType: `multipart/related; boundary=${boundary}`
  };
}

function cloudPayload(data: AuraStartData, deviceId: string): GoogleDriveSyncPayload {
  return {
    schemaVersion: CLOUD_SCHEMA_VERSION,
    app: CLOUD_APP_NAME,
    appVersion: appVersion(),
    updatedAt: nowIso(),
    deviceId,
    data
  };
}

function normalizeCloudUpdatedAt(payload: GoogleDriveSyncPayload): string {
  const dataTime = new Date(payload.data.updatedAt).getTime();
  if (Number.isFinite(dataTime)) {
    return new Date(dataTime).toISOString();
  }

  const payloadTime = new Date(payload.updatedAt).getTime();
  return Number.isFinite(payloadTime) ? new Date(payloadTime).toISOString() : nowIso();
}

function validateCloudPayload(value: unknown): GoogleDriveSyncPayload {
  if (!isRecord(value)) {
    throw new GoogleDriveSyncError("invalid_cloud_file", "Google Drive sync file must be a JSON object.");
  }

  if (value.schemaVersion !== CLOUD_SCHEMA_VERSION) {
    throw new GoogleDriveSyncError("invalid_cloud_file", "This Google Drive sync file version is not supported.");
  }

  if (value.app !== CLOUD_APP_NAME) {
    throw new GoogleDriveSyncError("invalid_cloud_file", "This is not an Aura Start Google Drive sync file.");
  }

  if (typeof value.appVersion !== "string" || !value.appVersion.trim()) {
    throw new GoogleDriveSyncError("invalid_cloud_file", "Google Drive sync file is missing appVersion.");
  }

  if (typeof value.updatedAt !== "string" || Number.isNaN(new Date(value.updatedAt).getTime())) {
    throw new GoogleDriveSyncError("invalid_cloud_file", "Google Drive sync file has an invalid updatedAt value.");
  }

  if (typeof value.deviceId !== "string" || !value.deviceId.trim()) {
    throw new GoogleDriveSyncError("invalid_cloud_file", "Google Drive sync file is missing deviceId.");
  }

  try {
    return {
      schemaVersion: CLOUD_SCHEMA_VERSION,
      app: CLOUD_APP_NAME,
      appVersion: value.appVersion,
      updatedAt: new Date(value.updatedAt).toISOString(),
      deviceId: value.deviceId,
      data: validateAuraData(value.data)
    };
  } catch (error) {
    if (error instanceof GoogleDriveSyncError) {
      throw error;
    }

    throw new GoogleDriveSyncError(
      "invalid_cloud_file",
      error instanceof Error ? error.message : "Google Drive sync file contains invalid Aura Start data."
    );
  }
}

async function requestFirefoxDriveSyncDataCollectionConsent(interactive: boolean): Promise<void> {
  if (!interactive || TARGET_BROWSER !== "firefox") {
    return;
  }

  const granted = await requestExtensionDataCollectionPermissions(FIREFOX_DRIVE_SYNC_DATA_COLLECTION_PERMISSIONS);
  if (!granted) {
    throw new GoogleDriveSyncError(
      "auth_cancelled",
      "Firefox data collection consent is required before Aura Start can sync saved links and settings with Google Drive."
    );
  }
}

export async function getAuthToken(interactive: boolean): Promise<string> {
  await requestFirefoxDriveSyncDataCollectionConsent(interactive);

  const installSource = detectGoogleDriveInstallSource();
  if (!interactive && installSource !== "chrome_web_store") {
    const cachedWebToken = await getCachedWebAuthToken();
    if (cachedWebToken) {
      return cachedWebToken;
    }
  }

  const manifestConfig = manifestOAuthConfig();
  const hasIdentityApi = hasExtensionIdentityApi();
  const hasGetAuthToken = hasExtensionIdentityGetAuthToken();
  const deviceOAuthClient = configuredDeviceOAuthClient();
  const webOAuthClientId = configuredWebOAuthClientId();

  if (interactive && installSource === "unpacked" && deviceOAuthClient) {
    // Local unpacked builds have a different extension ID on each install, so
    // the manifest Chrome Extension OAuth client often cannot authorize them.
    // Device OAuth avoids chromiumapp.org redirect URI registration entirely.
    console.debug?.("Aura Start Google Drive sync: using Device OAuth fallback for unpacked install.", {
      installSource
    });
    return await getDeviceAuthToken(interactive);
  }

  if (interactive && installSource === "unpacked" && webOAuthClientId) {
    console.debug?.("Aura Start Google Drive sync: using Web OAuth fallback for unpacked install.", {
      installSource
    });
    return await launchGoogleWebAuthFlow(interactive);
  }

  const {
    browserOAuthCapability,
    chromiumVariant,
    chromeIdentityUnsupported
  } = interactive
    ? await detectInteractiveAuthContext()
    : await detectNonInteractiveAuthContext();
  const flow = selectGoogleDriveAuthFlow({
    hasIdentityApi,
    hasGetAuthToken,
    manifestClientId: manifestConfig.clientId,
    manifestScopes: manifestConfig.scopes,
    chromeIdentityUnsupported,
    installSource,
    deviceOAuthClientId: deviceOAuthClient?.clientId,
    deviceOAuthClientSecret: deviceOAuthClient?.clientSecret,
    webOAuthClientId,
    targetBrowser: TARGET_BROWSER === "firefox" ? "firefox" : "chromium"
  });

  if (flow === "device_oauth") {
    console.debug?.("Aura Start Google Drive sync: using Device OAuth fallback.", {
      browserOAuthCapability,
      chromiumVariant,
      installSource
    });
    return await getDeviceAuthToken(interactive);
  }

  if (flow === "chrome_identity") {
    console.debug?.("Aura Start Google Drive sync: using chrome.identity.getAuthToken.", {
      browserOAuthCapability,
      chromiumVariant,
      installSource
    });
    return await getChromeAuthToken(interactive).catch(async (error) => {
      if (isChromeIdentityUnsupportedError(error) && deviceOAuthClient) {
        console.debug?.("Aura Start Google Drive sync: chrome.identity.getAuthToken is unsupported here; using Device OAuth fallback.", {
          browserOAuthCapability,
          chromiumVariant,
          installSource
        });
        return await getDeviceAuthToken(interactive);
      }

      if (isChromeIdentityUnsupportedError(error) && webOAuthClientId) {
        console.debug?.("Aura Start Google Drive sync: chrome.identity.getAuthToken is unsupported here; using Web OAuth fallback.", {
          browserOAuthCapability,
          chromiumVariant,
          installSource
        });
        return await launchGoogleWebAuthFlow(interactive);
      }

      if (isChromeIdentityUnsupportedError(error)) {
        throw new GoogleDriveSyncError(
          "identity_unavailable",
          "This browser rejected Chrome's built-in Google sign-in for Drive sync. Use Google Chrome, or rebuild Aura Start with the Device OAuth fallback configured."
        );
      }

      throw error;
    });
  }

  if (flow === "web_oauth") {
    console.debug?.("Aura Start Google Drive sync: using Web OAuth fallback.", {
      browserOAuthCapability,
      chromiumVariant,
      installSource
    });
    return await launchGoogleWebAuthFlow(interactive);
  }

  if (chromeIdentityUnsupported && !deviceOAuthClient && !webOAuthClientId) {
    throw new GoogleDriveSyncError(
      "identity_unavailable",
      "This browser does not support Chrome's built-in Google sign-in for Drive sync. Use Google Chrome, or build Aura Start with the Device OAuth fallback configured."
    );
  }

  throw new GoogleDriveSyncError("identity_unavailable", manifestOAuthConfigurationError(manifestConfig));
}

export async function getCachedAuthToken(): Promise<string | undefined> {
  return await getNonInteractiveCachedToken();
}

export async function clearAuthToken(token?: string): Promise<void> {
  const tokenToClear = token ?? await getNonInteractiveCachedToken();
  if (!tokenToClear) return;
  if (webAuthTokenCache?.token === tokenToClear) {
    webAuthTokenCache = undefined;
  }
  await removeStoredWebAuthToken();
  if (deviceAuthTokenCache?.token === tokenToClear) {
    deviceAuthTokenCache = undefined;
  }
  await removeStoredDeviceAuthToken();

  await removeCachedExtensionAuthToken(tokenToClear).catch((error) => {
    throw new GoogleDriveSyncError("unknown", error instanceof Error ? error.message : "Could not clear cached auth token.");
  });
}

export async function revokeAuthToken(token: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${OAUTH_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: "POST"
    });
  } catch (error) {
    throw new GoogleDriveSyncError(
      "network",
      error instanceof Error ? error.message : "Google OAuth token revoke failed."
    );
  }

  if (!response.ok) {
    throw await errorFromResponse(response);
  }
}

export async function disconnectGoogleAccount(token?: string): Promise<{ revokeError?: string }> {
  const tokenToDisconnect = token ?? await getNonInteractiveCachedToken();
  if (!tokenToDisconnect) {
    return {};
  }

  let revokeError: string | undefined;
  try {
    await revokeAuthToken(tokenToDisconnect);
  } catch (error) {
    revokeError = mapDriveError(error);
  }

  try {
    await clearAuthToken(tokenToDisconnect);
  } catch (error) {
    const clearError = mapDriveError(error);
    revokeError = revokeError ? `${revokeError}; ${clearError}` : clearError;
  }

  return { revokeError };
}

export async function getConnectedAccountInfo(): Promise<{
  email?: string;
  name?: string;
  avatarUrl?: string;
} | undefined> {
  const info = await getExtensionProfileUserInfo();
  const email = typeof info?.email === "string" && info.email ? info.email : undefined;
  return email ? { email } : undefined;
}

function syncFileQuery(storageMode: GoogleDriveStorageMode): string {
  const nameQuery = `name = '${SYNC_FILE_NAME}' and trashed = false`;
  if (storageMode === "drive_file") {
    return `${nameQuery} and appProperties has { key='${SYNC_FILE_APP_PROPERTY}' and value='${SYNC_FILE_APP_PROPERTY_VALUE}' }`;
  }

  return `${nameQuery} and 'appDataFolder' in parents`;
}

function syncFileListParams(storageMode: GoogleDriveStorageMode): URLSearchParams {
  const params = new URLSearchParams({
    q: syncFileQuery(storageMode),
    fields: "files(id,name,modifiedTime,size)",
    pageSize: "10"
  });

  if (storageMode === "app_data_folder") {
    params.set("spaces", "appDataFolder");
  }

  return params;
}

function syncFileCreateMetadata(storageMode: GoogleDriveStorageMode): RecordValue {
  const metadata: RecordValue = {
    name: SYNC_FILE_NAME,
    mimeType: "application/json"
  };

  if (storageMode === "app_data_folder") {
    metadata.parents = ["appDataFolder"];
  } else {
    metadata.appProperties = {
      [SYNC_FILE_APP_PROPERTY]: SYNC_FILE_APP_PROPERTY_VALUE,
      app: CLOUD_APP_NAME
    };
  }

  return metadata;
}

function syncFileUpdateMetadata(storageMode: GoogleDriveStorageMode): RecordValue {
  const metadata: RecordValue = {
    name: SYNC_FILE_NAME,
    mimeType: "application/json"
  };

  if (storageMode === "drive_file") {
    metadata.appProperties = {
      [SYNC_FILE_APP_PROPERTY]: SYNC_FILE_APP_PROPERTY_VALUE,
      app: CLOUD_APP_NAME
    };
  }

  return metadata;
}

export async function findSyncFile(token?: string): Promise<GoogleDriveFileMetadata | undefined> {
  const authToken = token ?? await getAuthToken(false);
  const params = syncFileListParams(storageModeForToken(authToken));
  const result = await driveFetch<{ files?: GoogleDriveFileMetadata[] }>(
    authToken,
    `${DRIVE_API_BASE}/files?${params.toString()}`
  );

  return result.files?.[0];
}

export async function getCloudFileMetadata(token?: string): Promise<GoogleDriveFileMetadata | undefined> {
  return await findSyncFile(token);
}

export async function createSyncFile(
  data: AuraStartData,
  deviceId: string,
  token?: string
): Promise<GoogleDriveFileMetadata> {
  const authToken = token ?? await getAuthToken(false);
  const payload = cloudPayload(data, deviceId);
  const multipart = createMultipartBody(syncFileCreateMetadata(storageModeForToken(authToken)), payload);
  const params = new URLSearchParams({
    uploadType: "multipart",
    fields: "id,name,modifiedTime,size"
  });

  return await driveFetch<GoogleDriveFileMetadata>(authToken, `${DRIVE_UPLOAD_BASE}/files?${params.toString()}`, {
    method: "POST",
    body: multipart.body,
    headers: {
      "Content-Type": multipart.contentType
    }
  });
}

export async function uploadSyncFile(
  data: AuraStartData,
  options: { deviceId: string; fileId?: string; token?: string }
): Promise<GoogleDriveFileMetadata> {
  const token = options.token ?? await getAuthToken(false);
  const payload = cloudPayload(data, options.deviceId);
  const metadata = syncFileUpdateMetadata(storageModeForToken(token));
  const multipart = createMultipartBody(metadata, payload);
  const params = new URLSearchParams({
    uploadType: "multipart",
    fields: "id,name,modifiedTime,size"
  });
  const currentFileId = options.fileId ?? (await findSyncFile(token))?.id;

  if (!currentFileId) {
    return await createSyncFile(data, options.deviceId, token);
  }

  try {
    return await driveFetch<GoogleDriveFileMetadata>(
      token,
      `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(currentFileId)}?${params.toString()}`,
      {
        method: "PATCH",
        body: multipart.body,
        headers: {
          "Content-Type": multipart.contentType
        }
      }
    );
  } catch (error) {
    if (error instanceof GoogleDriveSyncError && error.code === "not_found") {
      return await createSyncFile(data, options.deviceId, token);
    }

    throw error;
  }
}

export async function backupToDrive(
  data: AuraStartData,
  options: { deviceId: string; fileId?: string; token?: string }
): Promise<GoogleDriveFileMetadata> {
  return await uploadSyncFile(data, options);
}

export async function downloadSyncFile(
  fileId?: string,
  token?: string
): Promise<GoogleDriveSyncDownload | undefined> {
  const authToken = token ?? await getAuthToken(false);
  const metadata = fileId
    ? await driveFetch<GoogleDriveFileMetadata>(
        authToken,
        `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=id,name,modifiedTime,size`
      ).catch(async (error) => {
        if (error instanceof GoogleDriveSyncError && error.code === "not_found") {
          return await findSyncFile(authToken);
        }

        throw error;
      })
    : await findSyncFile(authToken);

  if (!metadata) {
    return undefined;
  }

  const rawPayload = await driveFetch<unknown>(
    authToken,
    `${DRIVE_API_BASE}/files/${encodeURIComponent(metadata.id)}?alt=media`
  );
  const payload = validateCloudPayload(rawPayload);

  return {
    metadata,
    payload,
    data: payload.data,
    cloudUpdatedAt: normalizeCloudUpdatedAt(payload)
  };
}

export async function restoreFromDrive(token?: string): Promise<GoogleDriveSyncDownload | undefined> {
  return await downloadSyncFile(undefined, token);
}

export function compareLocalAndCloud(
  localData: AuraStartData,
  cloud: GoogleDriveSyncDownload | undefined,
  syncSettings: AuraSyncSettings
): GoogleDriveComparison {
  if (!cloud) {
    return "no_cloud_file";
  }

  const lastSyncedTime = syncSettings.lastSyncedAt ? new Date(syncSettings.lastSyncedAt).getTime() : 0;
  const localTime = new Date(localData.updatedAt).getTime();
  const cloudTime = new Date(cloud.cloudUpdatedAt).getTime();

  if (!Number.isFinite(localTime) || !Number.isFinite(cloudTime)) {
    return "conflict";
  }

  const localChanged = lastSyncedTime > 0 ? localTime > lastSyncedTime : false;
  const cloudChanged = lastSyncedTime > 0 ? cloudTime > lastSyncedTime : false;

  if (localChanged && cloudChanged && Math.abs(localTime - cloudTime) > 1000) {
    return "conflict";
  }

  if (Math.abs(localTime - cloudTime) <= 1000) {
    return "in_sync";
  }

  return localTime > cloudTime ? "local_newer" : "cloud_newer";
}

export async function deleteSyncFile(token?: string): Promise<boolean> {
  const authToken = token ?? await getAuthToken(false);
  const metadata = await findSyncFile(authToken);
  if (!metadata) {
    return false;
  }

  await driveFetch<void>(authToken, `${DRIVE_API_BASE}/files/${encodeURIComponent(metadata.id)}`, {
    method: "DELETE"
  });
  return true;
}

export function mapDriveError(error: unknown): string {
  if (error instanceof GoogleDriveSyncError) {
    const message = error.message.toLowerCase();
    const reason = error.reason?.toLowerCase() ?? "";

    if (isGoogleDriveAuthorizationUnavailable(error)) {
      return "Google authorization expired or was revoked. Reconnect Google Drive to resume sync.";
    }
    if (error.code === "auth_cancelled") {
      return error.message || "Google authorization was cancelled or did not complete.";
    }
    if (error.code === "identity_unavailable") {
      return error.message;
    }
    if (error.code === "unauthorized") {
      return "Google authorization expired. Reconnect Google Drive and try again.";
    }
    if (error.code === "forbidden") {
      if (
        reason === "accessnotconfigured"
        || message.includes("api has not been used")
        || message.includes("api has not been enabled")
        || message.includes("it is disabled")
      ) {
        return "Google Drive API is disabled for this OAuth project. Enable Google Drive API in Google Cloud Console, wait a few minutes, then reconnect Google Drive.";
      }

      if (
        reason === "insufficientpermissions"
        || message.includes("insufficient authentication scopes")
        || message.includes("insufficient permission")
      ) {
        return "Google authorized Aura Start without the required Google Drive sync permission. Disconnect Google Account, connect again, and make sure the OAuth consent screen includes the requested Drive sync scope.";
      }

      return `Google Drive denied access: ${error.message}`;
    }
    if (error.code === "not_found") {
      return "No Google Drive sync file found.";
    }
    if (error.code === "rate_limited") {
      return "Google Drive rate limit reached. Try again later.";
    }
    if (error.code === "network") {
      return `Network error: ${error.message}`;
    }
    if (error.code === "invalid_cloud_file") {
      return error.message;
    }

    return error.message;
  }

  return error instanceof Error ? error.message : "Google Drive sync failed.";
}

export function isGoogleDriveAuthorizationUnavailable(error: unknown): boolean {
  if (!(error instanceof GoogleDriveSyncError)) {
    return false;
  }

  if (error.code === "unauthorized") {
    return true;
  }

  if (error.code !== "auth_cancelled") {
    return false;
  }

  const message = error.message.toLowerCase();
  const reason = error.reason?.toLowerCase() ?? "";
  return reason.includes("invalid_grant")
    || message.includes("invalid_grant")
    || message.includes("oauth2 not granted")
    || message.includes("not granted or revoked")
    || message.includes("token has been revoked")
    || message.includes("authorization has been revoked");
}
