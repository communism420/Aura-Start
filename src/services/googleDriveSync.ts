import type { AuraStartData } from "../types";
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
import { DEFAULT_SETTINGS } from "../constants";
import { ensureSyncReplica, mergeSyncData } from "../utils/syncReplica";
import { isBackgroundImageId, loadBackgroundImage, normalizeCustomBackgroundImage, storeBackgroundImage } from "../utils/backgroundImageStorage";
import { isTimerSoundId, loadTimerSound, normalizeTimerSoundAsset, storeTimerSound, type TimerSoundAsset } from "../utils/timerSoundStorage";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
const DRIVE_CONDITIONAL_API_BASE = "https://www.googleapis.com/drive/v2";
const DRIVE_CONDITIONAL_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v2";
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
const PUBLISHED_CHROME_WEB_STORE_EXTENSION_ID = "pdhhhnmcampmmklkbbfbmniijmgjiabi";
const TOKEN_EXPIRY_SAFETY_MS = 60_000;
const OAUTH_REFRESH_MAX_ATTEMPTS = 3;
const OAUTH_REFRESH_RETRY_BASE_MS = 400;
const DEVICE_OAUTH_INITIAL_POLL_DELAY_MS = 1_000;
const DEVICE_OAUTH_FAST_POLL_DELAY_MS = 1_500;
const DEVICE_OAUTH_FAST_POLL_WINDOW_MS = 15_000;
const WEB_AUTH_TOKEN_STORAGE_KEY = "aura-start-google-web-auth-token";
const DEVICE_AUTH_TOKEN_STORAGE_KEY = "aura-start-google-device-auth-token";
const AUTH_TOKEN_STORAGE_LOCK_NAME = "aura-start-google-auth-token-storage";
const AUTH_SESSION_STORAGE_KEY = "aura-start-google-auth-session";
export const GOOGLE_DEVICE_AUTH_EVENT = "aura-start:google-device-auth";
const FIREFOX_DRIVE_SYNC_DATA_COLLECTION_PERMISSIONS: ExtensionDataCollectionPermission[] = [
  "browsingActivity",
  "technicalAndInteraction"
];
const OAUTH_CLIENT_ID_PATTERN = /^[a-z0-9-]+\.apps\.googleusercontent\.com$/i;
const DRIVE_REQUEST_TIMEOUT_MS = 25_000;
const DRIVE_MEDIA_TIMEOUT_MS = 180_000;
const DRIVE_UPLOAD_BUDGET_MS = 240_000;
const DRIVE_RESUMABLE_THRESHOLD_BYTES = 1024 * 1024;
const DRIVE_UPLOAD_CHUNK_BYTES = 256 * 1024;
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
  grantedScopes?: string[];
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
  | "cloud_deleted"
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
  createdTime?: string;
  modifiedTime?: string;
  version?: string;
  size?: string;
  appProperties?: Record<string, string>;
  legacyAppData?: boolean;
};

export type GoogleDriveSyncPayload = {
  schemaVersion: 1;
  app: "Aura Start";
  appVersion: string;
  updatedAt: string;
  deviceId: string;
  data: AuraStartData;
  backgroundImage?: { id: string; dataUrl: string };
  timerSound?: TimerSoundAsset & { id: string };
};

export type GoogleDriveSyncDownload = {
  metadata: GoogleDriveFileMetadata;
  payload: GoogleDriveSyncPayload;
  data: AuraStartData;
  cloudUpdatedAt: string;
};

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
let fallbackAuthTokenLock: Promise<void> = Promise.resolve();
const authTokenReplacements = new Map<string, string>();
// Retain only in-memory credential lineage for in-flight requests. It lets a
// stale 401 fail without retrying another account's newly stored access token.
const deviceTokenLineages = new Map<string, string>();
const knownWebAuthTokens = new Set<string>();
type AuthSession = {
  generation: string;
  flow?: Exclude<GoogleDriveAuthFlow, "unavailable">;
  clientId?: string;
  disconnected?: true;
};
let memoryAuthSession: AuthSession = { generation: "legacy" };
const tokenAuthSessions = new Map<string, AuthSession>();
const pendingDeviceRefreshes = new Map<string, Promise<CachedDeviceToken>>();

function authFlowClientId(flow: AuthSession["flow"]): string | undefined {
  return flow === "device_oauth" ? configuredDeviceOAuthClient()?.clientId
    : flow === "web_oauth" ? configuredWebOAuthClientId()
      : flow === "chrome_identity" ? manifestOAuthConfig().clientId : undefined;
}

async function readAuthSession(): Promise<AuthSession> {
  const area = authTokenStorageAreas()[0];
  if (!area) return memoryAuthSession;
  let value: unknown;
  try { value = (await area.get(AUTH_SESSION_STORAGE_KEY))[AUTH_SESSION_STORAGE_KEY]; }
  catch { throw new GoogleDriveSyncError("unknown", "Google authorization storage is temporarily unavailable."); }
  if (value === undefined) return { generation: "legacy" };
  if (!isRecord(value) || typeof value.generation !== "string" || !value.generation
    || (value.flow !== undefined && !["device_oauth", "web_oauth", "chrome_identity"].includes(String(value.flow)))) {
    throw new GoogleDriveSyncError("unknown", "Google authorization session is temporarily unavailable.");
  }
  return { generation: value.generation, ...(value.flow ? { flow: value.flow as AuthSession["flow"] } : {}),
    ...(typeof value.clientId === "string" ? { clientId: value.clientId } : {}),
    ...(value.disconnected === true ? { disconnected: true as const } : {}) };
}

async function writeAuthSession(session: AuthSession): Promise<void> {
  await writeAuthTokenToStorage(AUTH_SESSION_STORAGE_KEY, session);
  memoryAuthSession = session;
}

async function requireAuthSession(session: AuthSession): Promise<AuthSession> {
  const current = await readAuthSession();
  if (current.generation !== session.generation || current.disconnected) throw authorizationChangedError();
  if (current.flow && (current.clientId !== authFlowClientId(current.flow)
    || (session.flow && current.flow !== session.flow))) throw authorizationChangedError();
  return current;
}

function rememberTokenSession(token: string, session: AuthSession): void {
  tokenAuthSessions.set(token, session);
  if (tokenAuthSessions.size > 64) tokenAuthSessions.delete(tokenAuthSessions.keys().next().value!);
}

async function bindAuthSession(session: AuthSession, flow: NonNullable<AuthSession["flow"]>, token: string): Promise<void> {
  const current = await requireAuthSession(session);
  if (current.flow && current.flow !== flow) throw authorizationChangedError();
  const bound: AuthSession = { generation: session.generation, flow, clientId: authFlowClientId(flow) };
  if (current.flow !== flow || current.clientId !== bound.clientId) await writeAuthSession(bound);
  rememberTokenSession(token, bound);
}

async function beginInteractiveAuth(session: AuthSession, flow: NonNullable<AuthSession["flow"]>): Promise<AuthSession> {
  return await withAuthTokenStorageLock(async () => {
    const current = await readAuthSession();
    if (current.generation !== session.generation) throw authorizationChangedError();
    const next: AuthSession = { generation: randomState(), flow, clientId: authFlowClientId(flow) };
    await writeAuthSession(next);
    return next;
  });
}

async function sessionForAuthentication(interactive: boolean): Promise<AuthSession> {
  const session = await readAuthSession();
  if (session.disconnected && !interactive) {
    throw new GoogleDriveSyncError("unauthorized", "Google Drive is disconnected on this device.", undefined, "local_disconnect");
  }
  if (!interactive && session.flow && session.clientId !== authFlowClientId(session.flow)) {
    throw new GoogleDriveSyncError("unauthorized", "This build uses a different Google OAuth client. Reconnect Google Drive explicitly or install the matching Aura Start build.", undefined, "oauth_client_changed");
  }
  return session;
}

function cacheWebAuthToken(value: CachedToken): void {
  webAuthTokenCache = value;
  knownWebAuthTokens.add(value.token);
  if (knownWebAuthTokens.size > 64) knownWebAuthTokens.delete(knownWebAuthTokens.values().next().value!);
}

function cacheDeviceAuthToken(value: CachedDeviceToken | undefined): void {
  deviceAuthTokenCache = value;
  if (!value) return;
  deviceTokenLineages.set(value.token, value.refreshToken);
  if (deviceTokenLineages.size > 64) deviceTokenLineages.delete(deviceTokenLineages.keys().next().value!);
}

function authorizationChangedError(): GoogleDriveSyncError {
  return new GoogleDriveSyncError("unknown", "Google authorization changed while this request was running. Sync will retry using the current connection.", undefined, "authorization_changed");
}

async function withAuthTokenStorageLock<T>(operation: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (locks) {
    return await locks.request(AUTH_TOKEN_STORAGE_LOCK_NAME, operation);
  }

  const pending = fallbackAuthTokenLock.then(operation, operation);
  fallbackAuthTokenLock = pending.then(() => undefined, () => undefined);
  return await pending;
}

function rememberAuthTokenReplacement(previousToken: string, nextToken: string): void {
  if (!previousToken || !nextToken || previousToken === nextToken) return;
  authTokenReplacements.set(previousToken, nextToken);
}

function currentAuthToken(token: string): string {
  let current = token;
  const visited = new Set<string>();
  while (!visited.has(current)) {
    visited.add(current);
    const replacement = authTokenReplacements.get(current);
    if (!replacement) break;
    current = replacement;
  }

  if (current !== token) {
    authTokenReplacements.set(token, current);
  }
  return current;
}

export function isFirefoxUserInputPermissionRequestError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";

  return /permissions\.request/i.test(message)
    && /may only be called from a user input handler/i.test(message);
}

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

function hasSharedDriveScopes(scopes: string[] | undefined): boolean {
  return Array.isArray(scopes) && scopes.length === 2
    && scopes.includes(DRIVE_APPDATA_SCOPE) && scopes.includes(DRIVE_FILE_SCOPE);
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
      && hasSharedDriveScopes(input.manifestScopes)
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
    return isUsableOAuthClientId(input.manifestClientId) && hasSharedDriveScopes(input.manifestScopes)
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

export type GoogleDriveConditionalDownload = GoogleDriveSyncDownload & { etag: string };

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

async function detectInteractiveAuthContext(): Promise<{
  browserOAuthCapability: GoogleDriveBrowserOAuthCapability;
  chromiumVariant: GoogleDriveChromiumVariant;
  chromeIdentityUnsupported: boolean;
}> {
  // Use the real authorization call to detect an unsupported API. A separate
  // short silent probe can time out or finish after the user disconnects.
  return await detectNonInteractiveAuthContext();
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

  if (!hasSharedDriveScopes(config.scopes)) {
    return "Google Drive sync needs drive.file for shared device snapshots and drive.appdata to migrate existing Chrome backups.";
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
  return scopes?.length ? scopes : [DRIVE_APPDATA_SCOPE, DRIVE_FILE_SCOPE];
}

export function googleDriveDeviceOAuthScopes(): string[] {
  return [DEVICE_OAUTH_DRIVE_SCOPE];
}

function storageModeForToken(token: string): GoogleDriveStorageMode {
  const current = currentAuthToken(token);
  return tokenAuthSessions.get(current)?.flow === "device_oauth" || deviceAuthTokenCache?.token === current ? "drive_file" : "app_data_folder";
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
  if (
    !isRecord(value)
    || typeof value.token !== "string"
    || !value.token.trim()
    || typeof value.expiresAt !== "number"
    || !Number.isFinite(value.expiresAt)
  ) {
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
  // Local storage is authoritative even when its value was removed. A stale
  // session mirror must not resurrect an account disconnected in another page.
  const primary = getExtensionStorageArea("local") ?? getExtensionStorageArea("session");
  return primary ? [primary] : [];
}

function webAuthTokenStorageAreas(): ExtensionStorageArea[] {
  return authTokenStorageAreas();
}

function deviceAuthTokenStorageAreas(): ExtensionStorageArea[] {
  return authTokenStorageAreas();
}

async function writeAuthTokenToStorage(key: string, value: unknown): Promise<void> {
  const local = getExtensionStorageArea("local");
  const session = getExtensionStorageArea("session");
  const item = { [key]: value };

  if (local) {
    await local.set(item);
    if (session) {
      await session.set(item).catch(() => undefined);
    }
    return;
  }

  if (session) {
    await session.set(item);
  }
}

async function removeAuthTokenFromStorage(key: string): Promise<void> {
  const local = getExtensionStorageArea("local");
  const session = getExtensionStorageArea("session");

  if (local) {
    await local.remove(key);
    if (session) {
      await session.remove(key).catch(() => undefined);
    }
    return;
  }

  if (session) {
    await session.remove(key);
  }
}

async function readStoredWebAuthToken(): Promise<string | undefined> {
  const areas = webAuthTokenStorageAreas();
  webAuthTokenCache = undefined;
  let successfulReads = 0;
  for (const area of areas) {
    let result: Record<string, unknown>;
    try {
      result = await area.get(WEB_AUTH_TOKEN_STORAGE_KEY);
      successfulReads += 1;
    } catch {
      continue;
    }

    const stored = result[WEB_AUTH_TOKEN_STORAGE_KEY];
    if (stored === undefined) continue;
    const cached = normalizeCachedToken(stored);
    if (!cached) continue;

    cacheWebAuthToken(cached);
    return cached.token;
  }

  if (areas.length > 0 && successfulReads === 0) {
    throw new GoogleDriveSyncError("unknown", "Google authorization storage is temporarily unavailable.");
  }

  return undefined;
}

async function writeStoredWebAuthToken(token: CachedToken): Promise<void> {
  await writeAuthTokenToStorage(WEB_AUTH_TOKEN_STORAGE_KEY, token);
}

async function removeStoredWebAuthToken(): Promise<void> {
  await removeAuthTokenFromStorage(WEB_AUTH_TOKEN_STORAGE_KEY);
}

function normalizeGrantedScopes(value: unknown): string[] | undefined {
  const items = typeof value === "string" ? value.split(/\s+/) : value;
  if (!Array.isArray(items) || !items.every((item) => typeof item === "string")) return undefined;
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function normalizeCachedDeviceToken(value: unknown): CachedDeviceToken | undefined {
  if (
    !isRecord(value)
    || typeof value.token !== "string"
    || !value.token.trim()
    || typeof value.refreshToken !== "string"
    || !value.refreshToken.trim()
    || typeof value.expiresAt !== "number"
    || !Number.isFinite(value.expiresAt)
  ) {
    return undefined;
  }

  return {
    token: value.token,
    refreshToken: value.refreshToken,
    expiresAt: value.expiresAt,
    ...(value.grantedScopes !== undefined ? { grantedScopes: normalizeGrantedScopes(value.grantedScopes) } : {})
  };
}

async function readStoredDeviceAuthToken(): Promise<CachedDeviceToken | undefined> {
  const areas = deviceAuthTokenStorageAreas();
  deviceAuthTokenCache = undefined;
  let successfulReads = 0;
  for (const area of areas) {
    let result: Record<string, unknown>;
    try {
      result = await area.get(DEVICE_AUTH_TOKEN_STORAGE_KEY);
      successfulReads += 1;
    } catch {
      continue;
    }

    const stored = result[DEVICE_AUTH_TOKEN_STORAGE_KEY];
    if (stored === undefined) continue;
    const cached = normalizeCachedDeviceToken(stored);
    if (!cached) continue;

    cacheDeviceAuthToken(cached);
    return cached;
  }

  if (areas.length > 0 && successfulReads === 0) {
    throw new GoogleDriveSyncError("unknown", "Google authorization storage is temporarily unavailable.");
  }

  return undefined;
}

async function writeStoredDeviceAuthToken(token: CachedDeviceToken): Promise<void> {
  await writeAuthTokenToStorage(DEVICE_AUTH_TOKEN_STORAGE_KEY, token);
}

async function removeStoredDeviceAuthToken(): Promise<void> {
  deviceAuthTokenCache = undefined;
  await removeAuthTokenFromStorage(DEVICE_AUTH_TOKEN_STORAGE_KEY);
}

async function getCachedWebAuthToken(): Promise<string | undefined> {
  return webAuthTokenStorageAreas().length > 0 ? await readStoredWebAuthToken() : cachedWebAuthToken();
}

async function getCachedDeviceAuthToken(): Promise<CachedDeviceToken | undefined> {
  return deviceAuthTokenStorageAreas().length > 0 ? await readStoredDeviceAuthToken() : deviceAuthTokenCache;
}

function isCachedAccessTokenUsable(cached: CachedToken): boolean {
  return Date.now() + TOKEN_EXPIRY_SAFETY_MS < cached.expiresAt;
}

async function getNonInteractiveCachedToken(): Promise<string | undefined> {
  const session = await sessionForAuthentication(false).catch((error: unknown) => {
    if (error instanceof GoogleDriveSyncError && error.reason === "local_disconnect") return undefined;
    throw error;
  });
  if (!session) return undefined;
  if (session.flow === "device_oauth") return await getDeviceAuthToken(false, session).catch(() => undefined);
  if (session.flow === "web_oauth") return await getCachedWebAuthToken();
  if (session.flow === "chrome_identity") return await getBoundChromeAuthToken(false, session).catch(() => undefined);
  const installSource = detectGoogleDriveInstallSource();
  const deviceOAuthClient = configuredDeviceOAuthClient();
  const webOAuthClientId = configuredWebOAuthClientId();
  // Cached credentials belong to an authorization flow (and may belong to a
  // different account). Never fall through to another flow's cached account.
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
    return await getDeviceAuthToken(false, session).catch(() => undefined);
  }

  if (flow === "web_oauth") {
    return await getCachedWebAuthToken();
  }

  if (flow === "chrome_identity") {
    return await getBoundChromeAuthToken(false, session).catch(async (error: unknown) => {
      // Match getAuthToken's explicit unsupported-identity fallback, while an
      // expired or missing native grant must not select another cached account.
      if (isChromeIdentityUnsupportedError(error)) {
        if (deviceOAuthClient) return await getDeviceAuthToken(false, session).catch(() => undefined);
        if (webOAuthClientId) return await getCachedWebAuthToken();
      }
      return undefined;
    });
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
    || message.includes("custom uri scheme")
    || message.includes("not supported on chrome apps");
}

async function getChromeAuthToken(interactive: boolean, timeoutMs?: number): Promise<string> {
  requireIdentityApi();
  timeoutMs ??= interactive ? undefined : DRIVE_REQUEST_TIMEOUT_MS;
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

async function getBoundChromeAuthToken(interactive: boolean, session: AuthSession): Promise<string> {
  const active = session.disconnected && interactive ? await beginInteractiveAuth(session, "chrome_identity") : session;
  await requireAuthSession(active);
  const token = await getChromeAuthToken(interactive);
  try {
    await withAuthTokenStorageLock(async () => { await bindAuthSession(active, "chrome_identity", token); });
  } catch (error) {
    const current = await readAuthSession().catch(() => undefined);
    if (current?.disconnected || current?.generation === active.generation) {
      await removeCachedExtensionAuthToken(token).catch(() => undefined);
    }
    throw error;
  }
  return token;
}

async function launchGoogleWebAuthFlow(interactive: boolean, expectedSession?: AuthSession): Promise<string> {
  const session = expectedSession ?? await sessionForAuthentication(interactive);
  const clientId = configuredWebOAuthClientId();
  if (!clientId) {
    throw new GoogleDriveSyncError(
      "identity_unavailable",
      "This build uses Chrome's built-in Google sign-in for Drive sync. The Web OAuth fallback is not configured."
    );
  }

  const cached = session.disconnected ? undefined : await getCachedWebAuthToken();
  if (cached) {
    await withAuthTokenStorageLock(async () => { await bindAuthSession(session, "web_oauth", cached); });
    return cached;
  }

  requireIdentityApi();
  if (!hasExtensionWebAuthFlow()) {
    throw new GoogleDriveSyncError(
      "identity_unavailable",
      "This browser does not support the Google OAuth web auth flow required for Drive sync."
    );
  }

  const active = interactive ? await beginInteractiveAuth(session, "web_oauth") : session;
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
      const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Google authorization did not complete.";
      // Silent Web OAuth can require consent/login without a revoked grant.
      // Only this explicit browser response warrants an interactive retry;
      // network failures and a user's cancellation must remain recoverable.
      const reason = !interactive && /^user interaction (?:is )?required\.?$/i.test(message.trim())
        ? "interaction_required" : undefined;
      throw new GoogleDriveSyncError(
        "auth_cancelled",
        message, undefined, reason
      );
    });

  const redirectedUrl = new URL(redirectResult);
  const fragmentParams = new URLSearchParams(redirectedUrl.hash.startsWith("#") ? redirectedUrl.hash.slice(1) : "");
  const queryParams = redirectedUrl.searchParams;
  const params = fragmentParams.size ? fragmentParams : queryParams;
  if (params.get("state") !== state) {
    throw new GoogleDriveSyncError("auth_cancelled", "Google authorization returned an invalid state.");
  }
  const error = params.get("error");
  if (error) {
    throw new GoogleDriveSyncError("auth_cancelled", params.get("error_description") ?? error, undefined, error);
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
  await withAuthTokenStorageLock(async () => {
    await requireAuthSession(active);
    await writeStoredWebAuthToken(cachedToken);
    cacheWebAuthToken(cachedToken);
    await bindAuthSession(active, "web_oauth", token);
  });

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
  scope?: string;
  error?: string;
  error_description?: string;
  error_subtype?: string;
};

export function isPermanentGoogleOAuthRefreshFailure(status: number, reason?: string): boolean {
  return status === 400 && reason?.toLowerCase() === "invalid_grant";
}

export function isTransientGoogleOAuthRefreshFailure(status: number, reason?: string): boolean {
  const normalizedReason = reason?.toLowerCase() ?? "";
  return status === 408
    || status === 425
    || status === 429
    || status >= 500
    || normalizedReason === "temporarily_unavailable"
    || normalizedReason === "server_error";
}

export function googleOAuthRefreshRetryDelayMs(attempt: number): number {
  return OAUTH_REFRESH_RETRY_BASE_MS * 2 ** Math.max(0, Math.min(attempt, OAUTH_REFRESH_MAX_ATTEMPTS - 1));
}

async function readGoogleOAuthJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => undefined);
  return (isRecord(body) ? body : {}) as T;
}

async function requestGoogleDeviceCode(clientId: string, scopes = googleDriveDeviceOAuthScopes()): Promise<Required<Pick<GoogleDeviceCodeResponse, "device_code" | "user_code" | "verification_url">> & {
  verification_url_complete?: string;
  expires_in: number;
  interval: number;
}> {
  const body = new URLSearchParams({
    client_id: clientId,
    scope: scopes.join(" ")
  });
  const response = await fetch(GOOGLE_DEVICE_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(DRIVE_REQUEST_TIMEOUT_MS)
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
    expiresAt: Date.now() + expiresIn * 1000,
    ...(json.scope !== undefined ? { grantedScopes: normalizeGrantedScopes(json.scope) } : {})
  };
}

function requireGrantedDriveScopes(token: CachedDeviceToken, required: string[]): void {
  // Older cached grants and some OAuth responses omit scope. API probes remain
  // authoritative for those; an explicitly partial grant must not be persisted.
  const scopes = token.grantedScopes;
  if (scopes && required.some((scope) => !scopes.includes(scope))) {
    const access = required.includes(DRIVE_APPDATA_SCOPE) ? "Aura Start files and hidden app data" : "Aura Start files";
    throw new GoogleDriveSyncError("forbidden", `Google did not grant all required Drive permissions. Allow access to ${access}, then retry.`, 403, "insufficientPermissions");
  }
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
    body,
    signal: AbortSignal.timeout(DRIVE_REQUEST_TIMEOUT_MS)
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

async function refreshGoogleDeviceTokenOnce(
  client: { clientId: string; clientSecret: string },
  refreshToken: string
): Promise<CachedDeviceToken> {
  const body = new URLSearchParams({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });
  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(DRIVE_REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    throw new GoogleDriveSyncError(
      "network",
      error instanceof Error ? error.message : "Google Device OAuth refresh could not reach Google."
    );
  }
  const json = await readGoogleOAuthJson<GoogleDeviceTokenResponse>(response);

  if (!response.ok) {
    const permanentlyRejected = isPermanentGoogleOAuthRefreshFailure(response.status, json.error);
    throw new GoogleDriveSyncError(
      permanentlyRejected
        ? "unauthorized"
        : isTransientGoogleOAuthRefreshFailure(response.status, json.error)
          ? response.status === 429 ? "rate_limited" : "network"
          : "identity_unavailable",
      json.error_description ?? json.error ?? "Google Device OAuth refresh failed.",
      response.status,
      json.error
    );
  }

  return deviceTokenFromResponse(json, refreshToken);
}

function isTransientGoogleOAuthRefreshError(error: unknown): boolean {
  return error instanceof GoogleDriveSyncError
    && (
      error.code === "network"
      || error.code === "rate_limited"
      || isTransientGoogleOAuthRefreshFailure(error.status ?? 0, error.reason)
    );
}

async function refreshGoogleDeviceToken(
  client: { clientId: string; clientSecret: string },
  refreshToken: string
): Promise<CachedDeviceToken> {
  let lastError: unknown;
  for (let attempt = 0; attempt < OAUTH_REFRESH_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await refreshGoogleDeviceTokenOnce(client, refreshToken);
    } catch (error) {
      lastError = error;
      if (!isTransientGoogleOAuthRefreshError(error) || attempt === OAUTH_REFRESH_MAX_ATTEMPTS - 1) {
        throw error;
      }
      await new Promise((resolve) => globalThis.setTimeout(resolve, googleOAuthRefreshRetryDelayMs(attempt)));
    }
  }

  throw lastError;
}

async function refreshStoredDeviceAuthToken(
  client: { clientId: string; clientSecret: string },
  options: { failedAccessToken?: string; force?: boolean; expectedRefreshToken?: string; session?: AuthSession } = {}
): Promise<CachedDeviceToken> {
  const captured = await withAuthTokenStorageLock(async () => {
    const session = options.session ?? await sessionForAuthentication(false);
    await requireAuthSession(session);
    const cached = await getCachedDeviceAuthToken();
    if (options.expectedRefreshToken && cached?.refreshToken !== options.expectedRefreshToken) throw authorizationChangedError();
    if (!cached) throw new GoogleDriveSyncError("unauthorized", "Google Drive needs sign-in to continue syncing.", undefined, "missing_authorization");
    const ready = isCachedAccessTokenUsable(cached) && (!options.force
      || Boolean(options.failedAccessToken && cached.token !== options.failedAccessToken));
    if (ready) {
      await bindAuthSession(session, "device_oauth", cached.token);
      if (options.failedAccessToken) rememberAuthTokenReplacement(options.failedAccessToken, cached.token);
    }
    return { session, cached, ready };
  });
  if (captured.ready) return captured.cached;

  // Never hold the storage lock during a network request: a user's disconnect
  // must be able to fence this refresh immediately, even while Google is offline.
  const key = JSON.stringify([captured.session.generation, captured.cached.refreshToken]);
  let pending = pendingDeviceRefreshes.get(key);
  if (!pending) {
    pending = refreshGoogleDeviceToken(client, captured.cached.refreshToken);
    pendingDeviceRefreshes.set(key, pending);
    const release = () => { if (pendingDeviceRefreshes.get(key) === pending) pendingDeviceRefreshes.delete(key); };
    void pending.then(release, release);
  }
  let refreshed: CachedDeviceToken;
  try { refreshed = await pending; }
  catch (error) {
    return await withAuthTokenStorageLock(async () => {
      await requireAuthSession(captured.session);
      const current = await getCachedDeviceAuthToken();
      if (current && current.refreshToken === captured.cached.refreshToken
        && current.token !== captured.cached.token && isCachedAccessTokenUsable(current)) {
        await bindAuthSession(captured.session, "device_oauth", current.token);
        rememberAuthTokenReplacement(captured.cached.token, current.token);
        return current;
      }
      if (!current || current.refreshToken !== captured.cached.refreshToken) throw authorizationChangedError();
      if (error instanceof GoogleDriveSyncError && isPermanentGoogleOAuthRefreshFailure(error.status ?? 0, error.reason)) {
        await removeStoredDeviceAuthToken();
      }
      throw error;
    });
  }
  return await withAuthTokenStorageLock(async () => {
    await requireAuthSession(captured.session);
    const current = await getCachedDeviceAuthToken();
    if (!current) throw authorizationChangedError();
    // Another context may already have committed this refresh (including a
    // rotated refresh token). Reuse it, never overwrite a different grant.
    if (current.token !== captured.cached.token) {
      if ((current.refreshToken === captured.cached.refreshToken || current.refreshToken === refreshed.refreshToken)
        && isCachedAccessTokenUsable(current)) {
        await bindAuthSession(captured.session, "device_oauth", current.token);
        rememberAuthTokenReplacement(captured.cached.token, current.token);
        return current;
      }
      throw authorizationChangedError();
    }
    if (current.refreshToken !== captured.cached.refreshToken) throw authorizationChangedError();
    refreshed.grantedScopes ??= current.grantedScopes;
    await bindAuthSession(captured.session, "device_oauth", refreshed.token);
    await writeStoredDeviceAuthToken(refreshed);
    cacheDeviceAuthToken(refreshed);
    rememberAuthTokenReplacement(captured.cached.token, refreshed.token);
    return refreshed;
  });
}

async function getDeviceAuthToken(interactive: boolean, expectedSession?: AuthSession): Promise<string> {
  const session = expectedSession ?? await sessionForAuthentication(interactive);
  const client = configuredDeviceOAuthClient();
  if (!client) throw new GoogleDriveSyncError("identity_unavailable", "This build does not include the Google Device OAuth fallback required by this browser.");
  const cached = session.disconnected ? undefined : await getCachedDeviceAuthToken();
  if (cached) {
    try {
      requireGrantedDriveScopes(cached, googleDriveDeviceOAuthScopes());
      const refreshed = await refreshStoredDeviceAuthToken(client, { session });
      return refreshed.token;
    } catch (error) {
      if (!interactive || !(error instanceof GoogleDriveSyncError)
        || !(isPermanentGoogleOAuthRefreshFailure(error.status ?? 0, error.reason) || isGoogleDriveScopeError(error))) throw error;
      // A confirmed revoked/insufficient grant can be replaced only following
      // this explicit user action; transient failures retain the existing grant.
      await clearAuthToken(cached.token, session.generation);
      return await getDeviceAuthToken(true);
    }
  }
  if (!interactive) throw new GoogleDriveSyncError("unauthorized", "Google Drive needs sign-in to continue syncing.", undefined, "missing_authorization");
  const active = await beginInteractiveAuth(session, "device_oauth");
  const result = await authorizeGoogleDeviceToken(client, active);
  requireGrantedDriveScopes(result, googleDriveDeviceOAuthScopes());
  await withAuthTokenStorageLock(async () => {
    await requireAuthSession(active);
    await bindAuthSession(active, "device_oauth", result.token);
    await writeStoredDeviceAuthToken(result);
    cacheDeviceAuthToken(result);
  });
  return result.token;
}

async function authorizeGoogleDeviceToken(
  client: { clientId: string; clientSecret: string },
  session: AuthSession
): Promise<CachedDeviceToken> {
  await requireAuthSession(session);
  const code = await requestGoogleDeviceCode(client.clientId, googleDriveDeviceOAuthScopes());
  await requireAuthSession(session);
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
    await requireAuthSession(session);
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
    await requireAuthSession(session);
    firstPoll = false;
    const result = await exchangeGoogleDeviceCode(client, code.device_code);
    await requireAuthSession(session);
    if (result === "authorization_pending") {
      continue;
    }
    if (result === "slow_down") {
      slowedDown = true;
      intervalMs += 5000;
      continue;
    }

    return result;
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
    const scopeDetail = body.error?.details?.find((item) => isRecord(item)
      && item.reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT");
    reason = scopeDetail ? "ACCESS_TOKEN_SCOPE_INSUFFICIENT"
      : body.error?.errors?.find((item) => item.reason)?.reason ?? body.error?.status;
  } catch {
    // Keep the HTTP status text when Google returns a non-JSON error body.
  }

  return new GoogleDriveSyncError(statusCodeToErrorCode(response.status), message, response.status, reason);
}

async function performDriveFetch(token: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(DRIVE_REQUEST_TIMEOUT_MS),
      headers: driveHeaders(token, init.headers)
    });
  } catch (error) {
    throw new GoogleDriveSyncError(
      "network",
      error instanceof Error ? error.message : "Network connection failed."
    );
  }
}

async function renewAuthTokenAfterUnauthorized(failedAccessToken: string, expectedRefreshToken?: string, knownWebToken = false): Promise<string> {
  const requestSession = tokenAuthSessions.get(failedAccessToken);
  if (requestSession) await requireAuthSession(requestSession);
  const deviceClient = configuredDeviceOAuthClient();
  if (deviceClient) {
    const lineage = expectedRefreshToken ?? deviceTokenLineages.get(failedAccessToken);
    if (lineage) {
      const refreshed = await refreshStoredDeviceAuthToken(deviceClient, {
        failedAccessToken, force: true, expectedRefreshToken: lineage
      });
      return refreshed.token;
    }
    const cachedDeviceToken = await getCachedDeviceAuthToken();
    if (cachedDeviceToken?.token === failedAccessToken) {
      const refreshed = await refreshStoredDeviceAuthToken(deviceClient, {
        failedAccessToken,
        force: true,
        expectedRefreshToken: cachedDeviceToken.refreshToken
      });
      return refreshed.token;
    }
  }

  // A native Chrome request must not erase an unrelated Web fallback grant.
  if (knownWebToken || knownWebAuthTokens.has(failedAccessToken)) {
    await withAuthTokenStorageLock(async () => {
      const cachedWebToken = await getCachedWebAuthToken();
      if (cachedWebToken !== failedAccessToken) throw authorizationChangedError();
      webAuthTokenCache = undefined;
      await removeStoredWebAuthToken();
    });
  }
  await removeCachedExtensionAuthToken(failedAccessToken).catch(() => undefined);

  const renewedToken = await getAuthToken(false);
  if (requestSession) await requireAuthSession(requestSession);
  rememberAuthTokenReplacement(failedAccessToken, renewedToken);
  return renewedToken;
}

async function driveFetchResponse(token: string, url: string, init: RequestInit = {}, acceptIncomplete = false): Promise<Response> {
  let requestToken = currentAuthToken(token);
  const requestSession = tokenAuthSessions.get(requestToken);
  if (requestSession) await requireAuthSession(requestSession);
  const expectedRefreshToken = deviceTokenLineages.get(requestToken);
  const knownWebToken = knownWebAuthTokens.has(requestToken);
  let response = await performDriveFetch(requestToken, url, init);

  if (response.status === 401) {
    requestToken = await renewAuthTokenAfterUnauthorized(requestToken, expectedRefreshToken, knownWebToken);
    response = await performDriveFetch(requestToken, url, init);
    if (response.status === 401) {
      throw new GoogleDriveSyncError("network", "Google Drive temporarily rejected the renewed access token. Aura Start will retry automatically.", 401, "renewed_token_rejected");
    }
  }

  if (!response.ok && !(acceptIncomplete && response.status === 308)) {
    throw await errorFromResponse(response);
  }
  return response;
}

async function driveFetch<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const response = await driveFetchResponse(token, url, init);
  if (response.status === 204) {
    return undefined as T;
  }

  return await response.json() as T;
}

/** Keep only a bounded, active media transfer alive in an MV3 worker. */
async function withDriveMediaTransfer<T>(operation: () => Promise<T>): Promise<T> {
  const area = typeof document === "undefined" ? getExtensionStorageArea("local") : undefined;
  // Chrome documents periodic extension API calls for exceptional long-running
  // operations. This reads an unused key; it writes no state and stops in finally.
  const keepAlive = area ? globalThis.setInterval(() => {
    void area.get("aura-start-active-drive-transfer").catch(() => undefined);
  }, 20_000) : undefined;
  try {
    return await operation();
  } finally {
    if (keepAlive !== undefined) globalThis.clearInterval(keepAlive);
  }
}

function resumableSessionUrl(value: string | null, expectedUrl: string): string {
  try {
    const session = new URL(value ?? "");
    const expected = new URL(expectedUrl);
    if (session.origin === expected.origin && session.pathname === expected.pathname
      && !session.username && !session.password && !session.hash
      && session.searchParams.get("uploadType") === "resumable" && session.searchParams.get("upload_id")) {
      return session.href;
    }
  } catch { /* Treat an invalid session URL as a failed transfer, never a token destination. */ }
  throw new GoogleDriveSyncError("invalid_cloud_file", "Google Drive returned an invalid upload session.");
}

function acknowledgedUploadBytes(response: Response, previous: number, sentEnd: number, total: number): number {
  const range = response.headers.get("Range");
  const match = range?.match(/^bytes=0-(\d+)$/);
  const received = range === null ? 0 : match ? Number(match[1]) + 1 : NaN;
  if (!Number.isSafeInteger(received) || received < previous || received > sentEnd || received > total) {
    throw new GoogleDriveSyncError("invalid_cloud_file", "Google Drive returned an invalid upload position.");
  }
  return received;
}

async function sendSyncPayload(
  token: string, url: string, method: "POST" | "PATCH" | "PUT", metadata: RecordValue, payload: GoogleDriveSyncPayload,
  extraHeaders: Record<string, string> = {}
): Promise<GoogleDriveFileMetadata> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (bytes.byteLength <= DRIVE_RESUMABLE_THRESHOLD_BYTES) {
    const multipart = createMultipartBody(metadata, payload);
    return await driveFetch<GoogleDriveFileMetadata>(token, url, {
      method, body: multipart.body, headers: { ...extraHeaders, "Content-Type": multipart.contentType }
    });
  }
  // A single large upload can exceed Chrome's 30-second fetch-response limit.
  // Resumable chunks keep each request small; Drive publishes the complete JSON
  // only when the session finishes, preserving the previous replica on failure.
  return await withDriveMediaTransfer(async () => {
    const deadline = Date.now() + DRIVE_UPLOAD_BUDGET_MS;
    const signal = () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new GoogleDriveSyncError("network", "The audio sync transfer took too long. Sync will retry later.");
      return AbortSignal.timeout(Math.min(DRIVE_REQUEST_TIMEOUT_MS, remaining));
    };
    const initialUrl = new URL(url);
    initialUrl.searchParams.set("uploadType", "resumable");
    const initialized = await driveFetchResponse(token, initialUrl.href, {
      method, signal: signal(), body: JSON.stringify(metadata),
      headers: { ...extraHeaders, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "application/json",
        "X-Upload-Content-Length": String(bytes.byteLength) }
    });
    const session = resumableSessionUrl(initialized.headers.get("Location"), initialUrl.href);
    let position = 0;
    let recoveryAttempts = 0;
    let stalledResponses = 0;
    while (position < bytes.byteLength) {
      const end = Math.min(position + DRIVE_UPLOAD_CHUNK_BYTES, bytes.byteLength);
      let response: Response;
      try {
        response = await driveFetchResponse(token, session, {
          method: "PUT", signal: signal(), body: new Blob([bytes.slice(position, end)], { type: "application/json" }),
          headers: { ...extraHeaders, "Content-Type": "application/json", "Content-Range": `bytes ${position}-${end - 1}/${bytes.byteLength}` }
        }, true);
      } catch (error) {
        if (!(error instanceof GoogleDriveSyncError)) throw error;
        if (error.code === "not_found") {
          // A session 404 is not a deleted replica; do not create a duplicate file.
          throw new GoogleDriveSyncError("network", "The Google Drive upload session expired. Sync will retry later.");
        }
        if ((error.code !== "network" && (error.status ?? 0) < 500) || ++recoveryAttempts > 3) throw error;
        // A lost response may have followed a successful write. Ask Drive for
        // its committed offset before sending any bytes again.
        response = await driveFetchResponse(token, session, {
          method: "PUT", signal: signal(), body: new Blob([]),
          headers: { ...extraHeaders, "Content-Range": `bytes */${bytes.byteLength}` }
        }, true).catch((statusError: unknown) => {
          if (statusError instanceof GoogleDriveSyncError && statusError.code === "not_found") {
            throw new GoogleDriveSyncError("network", "The Google Drive upload session expired. Sync will retry later.");
          }
          throw statusError;
        });
      }
      if (response.status === 200 || response.status === 201) {
        if (end < bytes.byteLength) {
          throw new GoogleDriveSyncError("invalid_cloud_file", "Google Drive confirmed an incomplete upload.");
        }
        const result: unknown = await response.json();
        if (!isRecord(result) || typeof result.id !== "string" || !result.id) {
          throw new GoogleDriveSyncError("invalid_cloud_file", "Google Drive did not confirm a complete upload.");
        }
        return result as GoogleDriveFileMetadata;
      }
      if (response.status !== 308) throw new GoogleDriveSyncError("network", "Google Drive did not complete the upload. Sync will retry later.");
      const next = acknowledgedUploadBytes(response, position, end, bytes.byteLength);
      if (next === position && ++stalledResponses > 2) {
        throw new GoogleDriveSyncError("network", "Google Drive made no upload progress. Sync will retry later.");
      }
      if (next > position) stalledResponses = 0;
      position = next;
    }
    throw new GoogleDriveSyncError("network", "Google Drive did not confirm the final upload. Sync will retry later.");
  });
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

async function cloudPayload(data: AuraStartData, deviceId: string): Promise<GoogleDriveSyncPayload> {
  const syncReplica = ensureSyncReplica(data);
  const imageId = data.settings.background.customImageId ?? null;
  if (syncReplica.settings["background.customImageId"].value !== imageId) {
    throw new GoogleDriveSyncError("invalid_cloud_file", "Custom background image and sync history do not match.");
  }
  const dataUrl = imageId ? await loadBackgroundImage(imageId) : null;
  if (imageId && !dataUrl) {
    throw new GoogleDriveSyncError("invalid_cloud_file", "Custom background image is unavailable locally. Sync will retry without replacing the cloud backup.");
  }
  const soundId = data.settings.timer.customSoundId ?? null;
  if (syncReplica.settings["timer.customSoundId"].value !== soundId) {
    throw new GoogleDriveSyncError("invalid_cloud_file", "Custom timer sound and sync history do not match.");
  }
  const sound = soundId ? await loadTimerSound(soundId) : null;
  if (soundId && !sound) {
    throw new GoogleDriveSyncError("invalid_cloud_file", "Custom timer sound is unavailable locally. Sync will retry without replacing the cloud backup.");
  }
  return {
    schemaVersion: CLOUD_SCHEMA_VERSION,
    app: CLOUD_APP_NAME,
    appVersion: appVersion(),
    updatedAt: nowIso(),
    deviceId,
    ...(imageId && dataUrl ? { backgroundImage: { id: imageId, dataUrl } } : {}),
    ...(soundId && sound ? { timerSound: { id: soundId, ...sound } } : {}),
    data: {
      ...data,
      syncReplica,
      settings: {
        ...data.settings,
        sync: { ...DEFAULT_SETTINGS.sync, deviceId,
          deleteCloudFileOnDisconnect: data.settings.sync.deleteCloudFileOnDisconnect }
      },
      restorePoints: []
    }
  };
}

/** Older uploads replaced device-local preferences with constant placeholders.
 * Only causal registers prove that a cloud file actually shared these choices.
 * Local storage and JSON backups retain their original preference values.
 */
function withoutLegacyCloudPreferencePlaceholders(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.settings)) return value;
  const replica = isRecord(value.syncReplica) ? value.syncReplica : undefined;
  const registers = replica && isRecord(replica.settings) ? replica.settings : undefined;
  const absent = ["captureOpenTabs", "sync.deleteCloudFileOnDisconnect"]
    .filter((path) => !registers || !Object.hasOwn(registers, path));
  if (!absent.length) return value;
  const settings = { ...value.settings };
  if (absent.includes("captureOpenTabs")) delete settings.captureOpenTabs;
  if (absent.includes("sync.deleteCloudFileOnDisconnect") && isRecord(settings.sync)) {
    const sync = { ...settings.sync };
    delete sync.deleteCloudFileOnDisconnect;
    settings.sync = sync;
  }
  const result: RecordValue = { ...value, settings };
  if (isRecord(value.settingsCompatibility) && isRecord(value.settingsCompatibility.preserved)) {
    const preserved = { ...value.settingsCompatibility.preserved };
    for (const path of absent) delete preserved[path];
    result.settingsCompatibility = { ...value.settingsCompatibility, preserved };
  }
  return result;
}

function normalizeCloudUpdatedAt(payload: GoogleDriveSyncPayload): string {
  const dataTime = new Date(payload.data.updatedAt).getTime();
  if (Number.isFinite(dataTime)) {
    return new Date(dataTime).toISOString();
  }

  const payloadTime = new Date(payload.updatedAt).getTime();
  return Number.isFinite(payloadTime) ? new Date(payloadTime).toISOString() : nowIso();
}

async function validateCloudPayload(value: unknown): Promise<GoogleDriveSyncPayload> {
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
    const data = validateAuraData(withoutLegacyCloudPreferencePlaceholders(value.data));
    const imageId = data.settings.background.customImageId ?? null;
    if (ensureSyncReplica(data).settings["background.customImageId"].value !== imageId) {
      throw new Error("Custom background image and sync history do not match.");
    }
    let backgroundImage: GoogleDriveSyncPayload["backgroundImage"];
    if (value.backgroundImage !== undefined || imageId) {
      const asset = value.backgroundImage;
      if (!isRecord(asset) || !isBackgroundImageId(asset.id) || asset.id !== imageId) {
        throw new Error("Google Drive sync file has a missing or mismatched custom background image.");
      }
      const dataUrl = normalizeCustomBackgroundImage(asset.dataUrl);
      if (!dataUrl) throw new Error("Google Drive sync file contains an invalid custom background image.");
      // Verify the content hash and durably store the bytes before exposing
      // their reference to the page or background synchronizer.
      await storeBackgroundImage(dataUrl, asset.id);
      backgroundImage = { id: asset.id, dataUrl };
    }
    const soundId = data.settings.timer.customSoundId ?? null;
    if (ensureSyncReplica(data).settings["timer.customSoundId"].value !== soundId) {
      throw new Error("Custom timer sound and sync history do not match.");
    }
    let timerSound: GoogleDriveSyncPayload["timerSound"];
    if (value.timerSound !== undefined || soundId) {
      const asset = value.timerSound;
      if (!isRecord(asset) || !isTimerSoundId(asset.id) || asset.id !== soundId) {
        throw new Error("Google Drive sync file has a missing or mismatched custom timer sound.");
      }
      const sound = normalizeTimerSoundAsset(asset);
      if (!sound) throw new Error("Google Drive sync file contains an invalid custom timer sound.");
      // The original file and portable playback audio travel together under
      // one hash; publish their reference only after both are verified/saved.
      await storeTimerSound(sound, asset.id);
      timerSound = { id: asset.id, ...sound };
    }
    return {
      schemaVersion: CLOUD_SCHEMA_VERSION,
      app: CLOUD_APP_NAME,
      appVersion: value.appVersion,
      updatedAt: new Date(value.updatedAt).toISOString(),
      deviceId: value.deviceId,
      data,
      ...(backgroundImage ? { backgroundImage } : {}),
      ...(timerSound ? { timerSound } : {})
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

  let granted: boolean;
  try {
    granted = await requestExtensionDataCollectionPermissions(FIREFOX_DRIVE_SYNC_DATA_COLLECTION_PERMISSIONS);
  } catch (error) {
    if (isFirefoxUserInputPermissionRequestError(error)) {
      console.warn?.(
        "Aura Start Firefox data collection consent prompt was rejected outside Firefox's direct user input stack. Continuing with Google OAuth because the data collection declaration is already present in the Firefox manifest.",
        error
      );
      return;
    }

    throw error;
  }

  if (!granted) {
    throw new GoogleDriveSyncError(
      "auth_cancelled",
      "Firefox data collection consent is required before Aura Start can sync saved links and settings with Google Drive."
    );
  }
}

export async function getAuthToken(interactive: boolean, options: { forceReauthorize?: boolean } = {}): Promise<string> {
  let session = await sessionForAuthentication(interactive);
  let preferredFlow: AuthSession["flow"];
  const changedClient = session.flow && session.clientId !== authFlowClientId(session.flow);
  if (options.forceReauthorize || changedClient) {
    if (!interactive) throw new GoogleDriveSyncError("auth_cancelled", "A new Google authorization requires an explicit user action.");
    preferredFlow = session.flow;
    await clearAuthToken(undefined, session.generation);
    session = await sessionForAuthentication(true);
  }
  if (session.disconnected && interactive) {
    session = await withAuthTokenStorageLock(async () => {
      const current = await readAuthSession();
      if (current.generation !== session.generation) throw authorizationChangedError();
      await removeStoredDeviceAuthToken();
      await removeStoredWebAuthToken();
      const next: AuthSession = { generation: randomState(),
        ...(preferredFlow && authFlowClientId(preferredFlow) ? { flow: preferredFlow, clientId: authFlowClientId(preferredFlow) } : {}) };
      await writeAuthSession(next);
      return next;
    });
  }
  await requestFirefoxDriveSyncDataCollectionConsent(interactive);
  if (session.flow === "device_oauth") return await getDeviceAuthToken(interactive, session);
  if (session.flow === "web_oauth") return await launchGoogleWebAuthFlow(interactive, session);
  if (session.flow === "chrome_identity") {
    const active = interactive ? await beginInteractiveAuth(session, "chrome_identity") : session;
    return await getBoundChromeAuthToken(interactive, active);
  }

  const installSource = detectGoogleDriveInstallSource();
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
    return await getDeviceAuthToken(interactive, session);
  }

  if (interactive && installSource === "unpacked" && webOAuthClientId) {
    console.debug?.("Aura Start Google Drive sync: using Web OAuth fallback for unpacked install.", {
      installSource
    });
    return await launchGoogleWebAuthFlow(interactive, session);
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
    return await getDeviceAuthToken(interactive, session);
  }

  if (flow === "chrome_identity") {
    console.debug?.("Aura Start Google Drive sync: using chrome.identity.getAuthToken.", {
      browserOAuthCapability,
      chromiumVariant,
      installSource
    });
    const active = interactive ? await beginInteractiveAuth(session, "chrome_identity") : session;
    return await getBoundChromeAuthToken(interactive, active).catch(async (error) => {
      if (isChromeIdentityUnsupportedError(error) && deviceOAuthClient) {
        console.debug?.("Aura Start Google Drive sync: chrome.identity.getAuthToken is unsupported here; using Device OAuth fallback.", {
          browserOAuthCapability,
          chromiumVariant,
          installSource
        });
        if (interactive) {
          await clearAuthToken(undefined, active.generation);
          return await getDeviceAuthToken(true);
        }
        return await getDeviceAuthToken(false, session);
      }

      if (isChromeIdentityUnsupportedError(error) && webOAuthClientId) {
        console.debug?.("Aura Start Google Drive sync: chrome.identity.getAuthToken is unsupported here; using Web OAuth fallback.", {
          browserOAuthCapability,
          chromiumVariant,
          installSource
        });
        if (interactive) {
          await clearAuthToken(undefined, active.generation);
          return await launchGoogleWebAuthFlow(true);
        }
        return await launchGoogleWebAuthFlow(false, session);
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
    return await launchGoogleWebAuthFlow(interactive, session);
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

async function verifyDeletionSpaceAccess(token: string, space: "drive" | "appDataFolder"): Promise<void> {
  const params = new URLSearchParams({ spaces: space, pageSize: "1", fields: "files(id)" });
  if (space === "appDataFolder") params.set("q", `'appDataFolder' in parents`);
  await driveFetch(token, `${DRIVE_API_BASE}/files?${params.toString()}`);
}

export async function getGoogleDriveDeletionAuthToken(_interactive = true): Promise<string> {
  // Never open a fresh account sign-in here: only an existing session can
  // establish which account the user meant to delete. Device OAuth uses its
  // existing drive.file grant; the configured endpoint rejects drive.appdata.
  const token = await getAuthToken(false).catch((error: unknown) => {
    if (error instanceof GoogleDriveSyncError && error.code === "auth_cancelled") {
      throw new GoogleDriveSyncError("unauthorized", "The existing Google authorization is unavailable. Reconnect Google Drive before deleting its backups.", error.status, "deletion_authorization_required");
    }
    throw error;
  });
  try {
    const deviceToken = storageModeForToken(token) === "drive_file";
    await verifyDeletionSpaceAccess(token, "drive");
    if (!deviceToken) await verifyDeletionSpaceAccess(token, "appDataFolder");
    return currentAuthToken(token);
  } catch (error) {
    if (!isGoogleDriveScopeError(error)) throw error;
    const access = storageModeForToken(token) === "drive_file" ? "Aura Start files" : "Aura Start files and hidden app data";
    throw new GoogleDriveSyncError("unauthorized", `Reconnect Google Drive and grant the requested access to ${access} before deleting its backups.`, 403, "deletion_scope_required");
  }
}

export async function clearAuthToken(token?: string, expectedGeneration?: string): Promise<void> {
  const requestedToken = token ? currentAuthToken(token) : undefined;
  const nativeTokens = new Set<string>();
  let clearError: unknown;
  await withAuthTokenStorageLock(async () => {
    const session = await readAuthSession();
    if (expectedGeneration && session.generation !== expectedGeneration) throw authorizationChangedError();
    if (requestedToken) {
      const recorded = tokenAuthSessions.get(requestedToken) ?? tokenAuthSessions.get(token!);
      if (recorded && recorded.generation !== session.generation) return;
      const device = await getCachedDeviceAuthToken();
      const web = await getCachedWebAuthToken();
      const lineage = deviceTokenLineages.get(requestedToken) ?? deviceTokenLineages.get(token!);
      const deviceMatches = device?.token === requestedToken || Boolean(device && lineage && device.refreshToken === lineage);
      const webMatches = web === requestedToken;
      const nativeMatches = recorded?.flow === "chrome_identity" && session.flow === "chrome_identity";
      if (!deviceMatches && !webMatches && !nativeMatches) return;
      if (nativeMatches) nativeTokens.add(requestedToken);
    } else {
      for (const [knownToken, recorded] of tokenAuthSessions) {
        if (recorded.flow === "chrome_identity" && recorded.generation === session.generation) nativeTokens.add(knownToken);
      }
    }
    // Persist the fence before deleting credentials. Even a later storage/API
    // failure cannot make a pending consent result reconnect this installation.
    await writeAuthSession({ generation: randomState(), disconnected: true });
    webAuthTokenCache = undefined;
    deviceAuthTokenCache = undefined;
    authTokenReplacements.clear();
    deviceTokenLineages.clear();
    knownWebAuthTokens.clear();
    // Keep bounded provenance for already-issued tokens. Forgetting it here
    // would let an old in-flight caller look like an untracked credential and
    // bypass the disconnected-generation check before its next Drive request.
    let storageError: unknown;
    try { await removeStoredWebAuthToken(); } catch (error) { storageError = error; }
    try { await removeStoredDeviceAuthToken(); } catch (error) { storageError ??= error; }
    if (storageError) throw storageError;
  }).catch((error) => { clearError = error; });
  for (const nativeToken of nativeTokens) {
    await removeCachedExtensionAuthToken(nativeToken).catch((error) => {
      clearError ??= new GoogleDriveSyncError("unknown", error instanceof Error ? error.message : "Could not clear cached auth token.");
    });
  }
  if (clearError) throw clearError;
}

export async function revokeAuthToken(token: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(OAUTH_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: currentAuthToken(token) }),
      signal: AbortSignal.timeout(DRIVE_REQUEST_TIMEOUT_MS)
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
  // Google /revoke invalidates every client in the project's account grant.
  // Unlink this installation locally so other Aura Start devices remain signed
  // in. The durable fence also blocks native Chrome from silently reconnecting.
  const suppliedToken = token ? currentAuthToken(token) : undefined;
  const knownNative = suppliedToken && tokenAuthSessions.get(suppliedToken)?.flow === "chrome_identity";
  let clearError: unknown;
  try { await clearAuthToken(); } catch (error) { clearError = error; }
  if (suppliedToken && !knownNative) {
    await removeCachedExtensionAuthToken(suppliedToken).catch((error) => { clearError ??= error; });
  }
  return clearError ? { revokeError: mapDriveError(clearError) } : {};
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

function syncFileQuery(storageMode: GoogleDriveStorageMode, deleting = false): string {
  const nameQuery = `name = '${SYNC_FILE_NAME}'${deleting ? "" : " and trashed = false"}`;
  if (storageMode === "drive_file") {
    return `${deleting ? "" : `${nameQuery} and `}appProperties has { key='${SYNC_FILE_APP_PROPERTY}' and value='${SYNC_FILE_APP_PROPERTY_VALUE}' }`;
  }

  return `${nameQuery} and 'appDataFolder' in parents`;
}

const REPLICA_DEVICE_PROPERTY = "auraStartDeviceId";
export const SHARED_SYNC_FILE_PROPERTY = "auraStartSharedSync";
const SYNC_METADATA_FIELDS = "id,name,createdTime,version,modifiedTime,size,appProperties";
const CONDITIONAL_METADATA_FIELDS = "id,title,etag,createdDate,modifiedDate,version,fileSize,properties";

async function listSyncFilesInSpace(token: string, storageMode: GoogleDriveStorageMode, deleting = false): Promise<GoogleDriveFileMetadata[]> {
  const files: GoogleDriveFileMetadata[] = [];
  const pages = new Set<string>();
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: syncFileQuery(storageMode, deleting),
      fields: `nextPageToken,incompleteSearch,files(${SYNC_METADATA_FIELDS})`,
      pageSize: "100",
      spaces: storageMode === "app_data_folder" ? "appDataFolder" : "drive"
    });
    if (deleting && storageMode === "drive_file") {
      params.set("corpora", "user");
      params.set("includeItemsFromAllDrives", "true");
      params.set("supportsAllDrives", "true");
    }
    if (pageToken) params.set("pageToken", pageToken);
    const result = await driveFetch<{ files?: GoogleDriveFileMetadata[]; nextPageToken?: string; incompleteSearch?: boolean }>(
      token, `${DRIVE_API_BASE}/files?${params.toString()}`
    );
    if (result.incompleteSearch) {
      throw new GoogleDriveSyncError("unknown", "Google Drive returned an incomplete file listing. Please retry later.");
    }
    for (const file of result.files ?? []) {
      if (!file.id || ((!deleting || storageMode === "app_data_folder") && file.name !== SYNC_FILE_NAME)) continue;
      if (storageMode === "drive_file" && file.appProperties?.[SYNC_FILE_APP_PROPERTY] !== SYNC_FILE_APP_PROPERTY_VALUE) continue;
      files.push({ ...file, legacyAppData: storageMode === "app_data_folder" });
    }
    pageToken = result.nextPageToken;
    if (pageToken && pages.has(pageToken)) {
      throw new GoogleDriveSyncError("unknown", "Google Drive returned a repeated listing page. Sync will retry later.");
    }
    if (pageToken) pages.add(pageToken);
  } while (pageToken);
  return files;
}

// Discover both the shared snapshot and older copies for safe consolidation.
export async function listSyncFiles(token?: string): Promise<GoogleDriveFileMetadata[]> {
  const authToken = token ?? await getAuthToken(false);
  const files = await listSyncFilesInSpace(authToken, "drive_file");
  if (storageModeForToken(authToken) === "app_data_folder") {
    files.push(...await listSyncFilesInSpace(authToken, "app_data_folder"));
  }
  return Array.from(new Map(files.map((file) => [file.id, file])).values())
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export async function findSyncFile(token?: string): Promise<GoogleDriveFileMetadata | undefined> {
  return (await listSyncFiles(token))[0];
}

export async function getCloudFileMetadata(token?: string): Promise<GoogleDriveFileMetadata | undefined> {
  return await findSyncFile(token);
}

export function isOwnSyncFile(file: GoogleDriveFileMetadata, deviceId: string): boolean {
  return !file.legacyAppData && file.name === SYNC_FILE_NAME
    && file.appProperties?.[SYNC_FILE_APP_PROPERTY] === SYNC_FILE_APP_PROPERTY_VALUE
    && file.appProperties?.[REPLICA_DEVICE_PROPERTY] === deviceId;
}

export function isSharedSyncFile(file: GoogleDriveFileMetadata): boolean {
  return !file.legacyAppData && file.name === SYNC_FILE_NAME
    && file.appProperties?.[SYNC_FILE_APP_PROPERTY] === SYNC_FILE_APP_PROPERTY_VALUE
    && file.appProperties?.[SHARED_SYNC_FILE_PROPERTY] === "1"
    && !Object.hasOwn(file.appProperties, REPLICA_DEVICE_PROPERTY);
}

function sharedFileMetadata(): RecordValue {
  return {
    name: SYNC_FILE_NAME,
    mimeType: "application/json",
    appProperties: {
      [SYNC_FILE_APP_PROPERTY]: SYNC_FILE_APP_PROPERTY_VALUE,
      [SHARED_SYNC_FILE_PROPERTY]: "1",
      app: CLOUD_APP_NAME
    }
  };
}

export async function createSharedSyncFile(data: AuraStartData, deviceId: string, token?: string): Promise<GoogleDriveFileMetadata> {
  const authToken = token ?? await getAuthToken(false);
  const params = new URLSearchParams({ uploadType: "multipart", fields: SYNC_METADATA_FIELDS });
  return await sendSyncPayload(authToken, `${DRIVE_UPLOAD_BASE}/files?${params.toString()}`, "POST",
    sharedFileMetadata(), await cloudPayload(data, deviceId));
}

function requireConditionalEtag(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim() === "*"
    || value !== value.trim() || /^W\//i.test(value) || /[\r\n]/.test(value)) {
    throw new GoogleDriveSyncError("invalid_cloud_file", "Google Drive did not provide a usable file ETag. Sync cannot safely update this backup.");
  }
  return value;
}

function conditionalFileMetadata(value: unknown, previous: GoogleDriveFileMetadata): { metadata: GoogleDriveFileMetadata; etag: string } {
  if (!isRecord(value) || value.id !== previous.id || typeof value.title !== "string" || !value.title) {
    throw new GoogleDriveSyncError("invalid_cloud_file", "Google Drive returned invalid conditional file metadata.");
  }
  const etag = requireConditionalEtag(value.etag);
  const appProperties: Record<string, string> = {};
  if (value.properties !== undefined && !Array.isArray(value.properties)) {
    throw new GoogleDriveSyncError("invalid_cloud_file", "Google Drive returned invalid conditional file properties.");
  }
  for (const property of Array.isArray(value.properties) ? value.properties : []) {
    if (isRecord(property) && property.visibility === "PRIVATE" && typeof property.key === "string"
      && typeof property.value === "string") {
      // Define keys without invoking Object.prototype setters for remote input.
      Object.defineProperty(appProperties, property.key, { value: property.value, enumerable: true, configurable: true, writable: true });
    }
  }
  return {
    etag,
    metadata: {
      id: value.id as string,
      name: value.title,
      ...(typeof value.createdDate === "string" ? { createdTime: value.createdDate } : {}),
      ...(typeof value.modifiedDate === "string" ? { modifiedTime: value.modifiedDate } : {}),
      ...(typeof value.version === "string" ? { version: value.version } : {}),
      ...(typeof value.fileSize === "string" ? { size: value.fileSize } : {}),
      appProperties,
      ...(previous.legacyAppData !== undefined ? { legacyAppData: previous.legacyAppData } : {})
    }
  };
}

async function getConditionalFileMetadata(metadata: GoogleDriveFileMetadata, token: string): Promise<{ metadata: GoogleDriveFileMetadata; etag: string }> {
  const params = new URLSearchParams({ fields: CONDITIONAL_METADATA_FIELDS, supportsAllDrives: "true" });
  const response = await driveFetch<unknown>(token,
    `${DRIVE_CONDITIONAL_API_BASE}/files/${encodeURIComponent(metadata.id)}?${params.toString()}`);
  return conditionalFileMetadata(response, metadata);
}

export function isGoogleDrivePreconditionFailed(error: unknown): boolean {
  return error instanceof GoogleDriveSyncError && error.status === 412;
}

export async function downloadConditionalSyncFile(
  metadata: GoogleDriveFileMetadata, token: string
): Promise<GoogleDriveConditionalDownload | undefined> {
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = await getConditionalFileMetadata(metadata, token);
      const downloaded = await downloadListedSyncFile(before.metadata, token);
      if (!downloaded) return undefined;
      const after = await getConditionalFileMetadata(before.metadata, token);
      if (before.etag === after.etag) return { ...downloaded, metadata: after.metadata, etag: after.etag };
    }
    throw new GoogleDriveSyncError("unknown", "The Google Drive backup changed during download. Sync will retry after merging its latest version.", 412, "conditional_read_changed");
  } catch (error) {
    if (error instanceof GoogleDriveSyncError && error.code === "not_found") return undefined;
    throw error;
  }
}

export async function updateConditionalSyncFile(
  data: AuraStartData, options: { deviceId: string; token: string; snapshot: GoogleDriveConditionalDownload }
): Promise<GoogleDriveFileMetadata> {
  const etag = requireConditionalEtag(options.snapshot.etag);
  const params = new URLSearchParams({ uploadType: "multipart", fields: CONDITIONAL_METADATA_FIELDS, supportsAllDrives: "true" });
  const metadata: RecordValue = {
    title: SYNC_FILE_NAME,
    mimeType: "application/json",
    properties: [
      { key: SYNC_FILE_APP_PROPERTY, value: SYNC_FILE_APP_PROPERTY_VALUE, visibility: "PRIVATE" },
      { key: SHARED_SYNC_FILE_PROPERTY, value: "1", visibility: "PRIVATE" },
      { key: "app", value: CLOUD_APP_NAME, visibility: "PRIVATE" }
    ]
  };
  // Drive v2 exposes File.etag. Chromium's Drive client uses exact If-Match for
  // multipart PUT and resumable initiation, and handles a final-chunk 412 too.
  // See chromium/google_apis/drive/drive_api_requests{,_unittest}.cc.
  // Never retry either path as an unconditional write after a conflict.
  const result = await sendSyncPayload(options.token,
    `${DRIVE_CONDITIONAL_UPLOAD_BASE}/files/${encodeURIComponent(options.snapshot.metadata.id)}?${params.toString()}`,
    "PUT", metadata, await cloudPayload(data, options.deviceId), { "If-Match": etag });
  return conditionalFileMetadata(result, options.snapshot.metadata).metadata;
}

export async function deleteConditionalSyncFile(snapshot: GoogleDriveConditionalDownload, token: string): Promise<void> {
  const etag = requireConditionalEtag(snapshot.etag);
  const params = new URLSearchParams({ supportsAllDrives: "true" });
  try {
    await driveFetch<void>(token,
      `${DRIVE_CONDITIONAL_API_BASE}/files/${encodeURIComponent(snapshot.metadata.id)}?${params.toString()}`,
      { method: "DELETE", headers: { "If-Match": etag } });
  } catch (error) {
    if (error instanceof GoogleDriveSyncError && error.code === "not_found") return;
    throw error;
  }
}

export async function createSyncFile(data: AuraStartData, deviceId: string, token?: string): Promise<GoogleDriveFileMetadata> {
  return await createSharedSyncFile(data, deviceId, token);
}

export async function uploadSyncFile(
  data: AuraStartData,
  options: { deviceId: string; fileId?: string; token?: string; expectedExistingFile?: boolean }
): Promise<GoogleDriveFileMetadata> {
  const token = options.token ?? await getAuthToken(false);
  // Compatibility entry point: a persisted per-device ID is only a hint from
  // older versions. Discovery and every mutation now use the shared CAS flow.
  const { synchronizeSharedGoogleDrive } = await import("./googleDriveSharedSync");
  const result = await synchronizeSharedGoogleDrive(data, {
    token, deviceId: options.deviceId, expectedExistingFile: options.expectedExistingFile
  });
  return result.metadata;
}

export async function backupToDrive(
  data: AuraStartData,
  options: { deviceId: string; fileId?: string; token?: string; expectedExistingFile?: boolean }
): Promise<GoogleDriveFileMetadata> {
  return await uploadSyncFile(data, options);
}

async function downloadListedSyncFile(metadata: GoogleDriveFileMetadata, token: string): Promise<GoogleDriveSyncDownload | undefined> {
  try {
    const rawPayload = await withDriveMediaTransfer(async () => await driveFetch<unknown>(token,
      `${DRIVE_API_BASE}/files/${encodeURIComponent(metadata.id)}?alt=media`, { signal: AbortSignal.timeout(DRIVE_MEDIA_TIMEOUT_MS) }));
    const payload = await validateCloudPayload(rawPayload);
    return { metadata, payload, data: payload.data, cloudUpdatedAt: normalizeCloudUpdatedAt(payload) };
  } catch (error) {
    if (error instanceof GoogleDriveSyncError && error.code === "not_found") return undefined;
    throw error;
  }
}

export async function downloadSyncFiles(token?: string, listedFiles?: GoogleDriveFileMetadata[]): Promise<GoogleDriveSyncDownload[]> {
  const authToken = token ?? await getAuthToken(false);
  const downloads: GoogleDriveSyncDownload[] = [];
  for (const metadata of listedFiles ?? await listSyncFiles(authToken)) {
    const download = await downloadListedSyncFile(metadata, authToken);
    if (download) downloads.push(download);
  }
  return downloads;
}

export async function downloadSyncFile(fileId?: string, token?: string): Promise<GoogleDriveSyncDownload | undefined> {
  const authToken = token ?? await getAuthToken(false);
  const files = await listSyncFiles(authToken);
  if (fileId) {
    const metadata = files.find((file) => file.id === fileId);
    if (metadata) return await downloadListedSyncFile(metadata, authToken);
  }
  let combined: GoogleDriveSyncDownload | undefined;
  for (const metadata of files) {
    const download = await downloadListedSyncFile(metadata, authToken);
    if (!download) continue;
    if (!combined) combined = download;
    else {
      const data = mergeSyncData(combined.data, download.data);
      const { backgroundImage: previousImage, timerSound: previousSound, ...previousPayload } = combined.payload;
      const imageId = data.settings.background.customImageId;
      const backgroundImage = imageId
        ? [previousImage, download.payload.backgroundImage].find((asset) => asset?.id === imageId)
        : undefined;
      const soundId = data.settings.timer.customSoundId;
      const timerSound = soundId
        ? [previousSound, download.payload.timerSound].find((asset) => asset?.id === soundId)
        : undefined;
      combined = {
        ...combined, data,
        payload: { ...previousPayload, data, ...(backgroundImage ? { backgroundImage } : {}), ...(timerSound ? { timerSound } : {}) }
      };
    }
  }
  return combined;
}

export async function restoreFromDrive(token?: string): Promise<GoogleDriveSyncDownload | undefined> {
  return await downloadSyncFile(undefined, token);
}
export type GoogleDriveDeletionResult = {
  deleted: boolean;
  legacyAppData: "verified" | "unavailable";
};

export async function deleteSyncFile(token?: string): Promise<GoogleDriveDeletionResult> {
  const authToken = token ?? await getAuthToken(false);
  const cachedDevice = await getCachedDeviceAuthToken();
  const isDeviceToken = cachedDevice?.token === currentAuthToken(authToken)
    || deviceTokenLineages.has(currentAuthToken(authToken));
  const scopes = cachedDevice?.token === currentAuthToken(authToken) ? cachedDevice.grantedScopes : undefined;
  let legacyAppData: GoogleDriveDeletionResult["legacyAppData"] = "verified";
  if (isDeviceToken && scopes !== undefined && !scopes.includes(DRIVE_APPDATA_SCOPE)) {
    legacyAppData = "unavailable";
  } else if (isDeviceToken && scopes === undefined) {
    // Older Device credentials did not persist granted scopes. Probe once, then
    // keep that result fixed: access lost after a successful probe is an error.
    try {
      await verifyDeletionSpaceAccess(authToken, "appDataFolder");
    } catch (error) {
      if (!isGoogleDriveScopeError(error)) throw error;
      legacyAppData = "unavailable";
    }
  }
  let deleted = false;
  // Complete discovery in every accessible space before deleting anything.
  // Rechecking catches replicas uploaded during a preceding deletion pass.
  for (let pass = 0; pass <= 3; pass += 1) {
    const listed = await listSyncFilesInSpace(authToken, "drive_file", true);
    if (legacyAppData === "verified") listed.push(...await listSyncFilesInSpace(authToken, "app_data_folder", true));
    const files = Array.from(new Map(listed.map((file) => [file.id, file])).values())
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (files.length === 0) return { deleted, legacyAppData };
    if (pass === 3) {
      throw new GoogleDriveSyncError("unknown", "Google Drive backups are still present after deletion. Pause syncing on other devices and retry.");
    }
    for (const file of files) {
      await driveFetch<void>(authToken, `${DRIVE_API_BASE}/files/${encodeURIComponent(file.id)}?supportsAllDrives=true`, { method: "DELETE" })
        .catch((error: unknown) => {
          if (!(error instanceof GoogleDriveSyncError) || error.code !== "not_found") throw error;
        });
    }
    deleted = true;
  }
  return { deleted, legacyAppData };
}

export function mapDriveError(error: unknown): string {
  if (error instanceof GoogleDriveSyncError) {
    const message = error.message.toLowerCase();
    const reason = error.reason?.toLowerCase() ?? "";

    if (reason === "deletion_scope_required") return error.message;
    if (isGoogleDriveScopeError(error)) {
      return "Google Drive permission is incomplete. Reconnect Google Drive and grant the access requested by Aura Start.";
    }

    if (isGoogleDriveAuthorizationUnavailable(error)) {
      return "Google authorization could not be refreshed automatically. Reconnect Google Drive to resume sync.";
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

export function isGoogleDriveScopeError(error: unknown): boolean {
  if (!(error instanceof GoogleDriveSyncError) || error.code !== "forbidden") return false;
  const reason = error.reason?.toLowerCase() ?? "";
  if (reason === "insufficientpermissions"
    || reason === "access_token_scope_insufficient"
    || /insufficient authentication scopes/i.test(error.message)
    || /granted scopes do not give access to all of the requested spaces/i.test(error.message)) return true;
  // File ACL failures cannot be fixed by requesting another OAuth grant.
  if (reason === "insufficientfilepermissions" || reason === "appnotauthorizedtofile") return false;
  return /^insufficient permissions?\.?$/i.test(error.message.trim());
}

export function isGoogleDriveAuthorizationUnavailable(error: unknown): boolean {
  if (!(error instanceof GoogleDriveSyncError)) {
    return false;
  }

  if (error.code === "unauthorized") {
    return true;
  }

  if (isGoogleDriveScopeError(error)) return true;

  if (error.code !== "auth_cancelled") {
    return false;
  }

  const message = error.message.toLowerCase();
  const reason = error.reason?.toLowerCase() ?? "";
  return ["login_required", "consent_required", "interaction_required", "account_selection_required"].includes(reason)
    || reason.includes("invalid_grant")
    || message.includes("invalid_grant")
    || message.includes("oauth2 not granted")
    || message.includes("not granted or revoked")
    || message.includes("token has been revoked")
    || message.includes("authorization has been revoked");
}
