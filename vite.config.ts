import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const OAUTH_CLIENT_ID_PATTERN = /^[a-z0-9-]+\.apps\.googleusercontent\.com$/i;
const EXTENSION_VERSION_PATTERN = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){1,3}$/;
const EXAMPLE_OAUTH_CLIENT_IDS = new Set([
  "123-example.apps.googleusercontent.com",
  "1234567890-abcdef.apps.googleusercontent.com"
]);

type ExtensionTargetBrowser = "chromium" | "firefox";

type AuraPackageJson = {
  version?: string;
  extensionVersions?: {
    chromium?: string;
    firefox?: string;
  };
};

/** Keep SDK defaults local even if a future caller omits explicit decoder URLs. */
export function localizeAudioDecoderDefault(source: string, id: string): string | null {
  if (!id.replaceAll("\\", "/").split("?")[0].endsWith("/node_modules/@ffmpeg/ffmpeg/dist/esm/const.js")) return null;
  const upstream = 'export const CORE_URL = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.js`;';
  if (source.split(upstream).length !== 2) throw new Error("Pinned FFmpeg SDK default changed; review the local decoder transform before building.");
  return source.replace(upstream, 'export const CORE_URL = new URL("../vendor/ffmpeg/ffmpeg-core.js", self.location.href).href;');
}

/** Run after Rollup so its literal import stays a separate, pinned local file. */
export function localizeAudioDecoderWorkerChunk(source: string): string {
  const loader = /\btry\s*\{[\s\S]*?importScripts\(_coreURL\);[\s\S]*?\}\s*catch\s*\{[\s\S]*?\}\s*(?=const coreURL = _coreURL;)/g;
  const matches = [...source.matchAll(loader)];
  if (matches.length !== 1 || !matches[0][0].includes("self.createFFmpegCore") || !matches[0][0].includes("_coreURL)).default") && !/\bimport\([\s\S]*?_coreURL[\s\S]*?\)\)\.default/.test(matches[0][0])) {
    throw new Error("Pinned FFmpeg worker loader changed; review its static local import before building.");
  }
  return source.replace(loader, '_coreURL = new URL("../vendor/ffmpeg/ffmpeg-core.js", self.location.href).href;\n  self.createFFmpegCore = (await import("../vendor/ffmpeg/ffmpeg-core.js")).default;\n  if (typeof self.createFFmpegCore !== "function") throw ERROR_IMPORT_FAILURE;\n  ');
}

export function localAudioDecoderSdkPlugin(): Plugin {
  return {
    name: "aura-local-audio-sdk",
    enforce: "pre",
    transform(source, id) {
      const result = localizeAudioDecoderDefault(source, id);
      return result === null ? null : { code: result, map: null };
    },
    renderChunk(source, chunk) {
      // ?worker&url is a tiny URL-export proxy in the page bundle, not the
      // worker implementation processed by the separate worker pipeline.
      if (!chunk.moduleIds.some((id) => id.replaceAll("\\", "/").split("?")[0].endsWith("/node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js")
        && !/(?:[?&])(?:worker|sharedworker)(?:&|$)/.test(id))) return null;
      return { code: localizeAudioDecoderWorkerChunk(source), map: null };
    }
  };
}

/** Ship the pinned single-thread decoder locally; imports never use a CDN. */
function bundledAudioDecoderPlugin(): Plugin {
  const assets = new Map([
    ["vendor/ffmpeg/ffmpeg-core.js", { file: "ffmpeg-core.js", type: "text/javascript" }],
    ["vendor/ffmpeg/ffmpeg-core.wasm", { file: "ffmpeg-core.wasm", type: "application/wasm" }]
  ]);
  const sourcePath = (file: string) => resolve(__dirname, "node_modules/@ffmpeg/core/dist/esm", file);
  return {
    name: "aura-local-audio-decoder",
    async generateBundle() {
      for (const [fileName, asset] of assets) {
        this.emitFile({ type: "asset", fileName, source: await readFile(sourcePath(asset.file)) });
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const asset = assets.get((request.url ?? "").split("?")[0].replace(/^\//, ""));
        if (!asset) { next(); return; }
        void readFile(sourcePath(asset.file)).then((source) => {
          response.setHeader("Content-Type", asset.type);
          response.end(source);
        }).catch(() => { response.statusCode = 500; response.end("Audio decoder unavailable."); });
      });
    }
  };
}

function normalizeOAuthClientId(clientId: string): string {
  return clientId.trim();
}

function looksLikeExampleOAuthClientId(clientId: string): boolean {
  const normalized = clientId.toLowerCase();
  return EXAMPLE_OAUTH_CLIENT_IDS.has(normalized)
    || normalized.includes("your_google_oauth_client_id")
    || normalized.includes("your-real-client-id")
    || normalized.includes("paste_real_client_id_here");
}

function assertExtensionVersion(version: string, label: string): string {
  const normalized = version.trim();
  if (!EXTENSION_VERSION_PATTERN.test(normalized)) {
    throw new Error(`${label} must use numeric dot notation compatible with browser extension manifests, for example 2.0.1.`);
  }

  return normalized;
}

function resolveExtensionVersion(packageJson: AuraPackageJson, targetBrowser: ExtensionTargetBrowser, env: Record<string, string | undefined>): string {
  const targetOverride = targetBrowser === "firefox"
    ? env.AURA_FIREFOX_EXTENSION_VERSION
    : env.AURA_CHROMIUM_EXTENSION_VERSION;
  const configuredVersion = targetBrowser === "firefox"
    ? packageJson.extensionVersions?.firefox
    : packageJson.extensionVersions?.chromium;
  const version = targetOverride?.trim()
    || env.AURA_EXTENSION_VERSION?.trim()
    || configuredVersion?.trim()
    || packageJson.version?.trim()
    || "";

  return assertExtensionVersion(version, `${targetBrowser} extension version`);
}

function manifestBuildPlugin(options: {
  clientId: string | undefined;
  extensionVersion: string;
  targetBrowser: ExtensionTargetBrowser;
}): Plugin {
  let manifestPath = resolve(__dirname, "dist", "manifest.json");

  return {
    name: "aura-manifest-build",
    apply: "build",
    configResolved(config) {
      manifestPath = resolve(config.root, config.build.outDir, "manifest.json");
    },
    async closeBundle() {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        version?: string;
        oauth2?: { client_id?: string; scopes?: string[] };
      };
      manifest.version = options.extensionVersion;

      if (options.clientId) {
        const normalizedClientId = normalizeOAuthClientId(options.clientId);
        if (!OAUTH_CLIENT_ID_PATTERN.test(normalizedClientId)) {
          throw new Error("AURA_GOOGLE_OAUTH_CLIENT_ID must be a real Google OAuth Client ID ending with .apps.googleusercontent.com.");
        }
        if (looksLikeExampleOAuthClientId(normalizedClientId)) {
          throw new Error("AURA_GOOGLE_OAUTH_CLIENT_ID points to an example value. Create a real OAuth Client ID in Google Cloud Console and use that value.");
        }

        manifest.oauth2 = {
          ...manifest.oauth2,
          client_id: normalizedClientId
        };
      }

      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      console.log(`Set ${options.targetBrowser} extension version ${options.extensionVersion} in ${manifestPath}.`);
      if (options.clientId) {
        console.log(`Injected Google OAuth Client ID into ${manifestPath}.`);
      }
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const targetBrowser = (process.env.AURA_TARGET_BROWSER ?? env.AURA_TARGET_BROWSER ?? "chromium").trim().toLowerCase();
  const resolvedTargetBrowser: ExtensionTargetBrowser = targetBrowser === "firefox" ? "firefox" : "chromium";
  const packageJson = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8")) as AuraPackageJson;
  const extensionVersion = resolveExtensionVersion(packageJson, resolvedTargetBrowser, {
    ...env,
    ...process.env
  });
  const googleOAuthClientId = resolvedTargetBrowser === "firefox"
    ? undefined
    : (process.env.AURA_GOOGLE_OAUTH_CLIENT_ID ?? env.AURA_GOOGLE_OAUTH_CLIENT_ID)?.trim();
  const storeBuild = process.env.AURA_STORE_BUILD === "true" || env.AURA_STORE_BUILD === "true";
  const googleWebOAuthClientId = storeBuild
    ? process.env.AURA_GOOGLE_WEB_OAUTH_CLIENT_ID?.trim() ?? ""
    : env.AURA_GOOGLE_WEB_OAUTH_CLIENT_ID?.trim() ?? "";
  const webOAuthFallbackSetting = storeBuild
    ? process.env.AURA_ENABLE_GOOGLE_WEB_OAUTH_FALLBACK
    : process.env.AURA_ENABLE_GOOGLE_WEB_OAUTH_FALLBACK ?? env.AURA_ENABLE_GOOGLE_WEB_OAUTH_FALLBACK;
  const enableGoogleWebOAuthFallback =
    Boolean(googleWebOAuthClientId) && webOAuthFallbackSetting !== "false";
  const googleWebOAuthRedirectPath = enableGoogleWebOAuthFallback
    ? (storeBuild ? "" : env.AURA_GOOGLE_WEB_OAUTH_REDIRECT_PATH?.trim() ?? "")
    : "";
  const googleDeviceOAuthClientId = storeBuild
    ? process.env.AURA_GOOGLE_DEVICE_OAUTH_CLIENT_ID?.trim() ?? ""
    : env.AURA_GOOGLE_DEVICE_OAUTH_CLIENT_ID?.trim() ?? "";
  const googleDeviceOAuthClientSecret = storeBuild
    ? process.env.AURA_GOOGLE_DEVICE_OAUTH_CLIENT_SECRET?.trim() ?? ""
    : env.AURA_GOOGLE_DEVICE_OAUTH_CLIENT_SECRET?.trim() ?? "";
  const deviceOAuthFallbackSetting = storeBuild
    ? process.env.AURA_ENABLE_GOOGLE_DEVICE_OAUTH_FALLBACK
    : process.env.AURA_ENABLE_GOOGLE_DEVICE_OAUTH_FALLBACK ?? env.AURA_ENABLE_GOOGLE_DEVICE_OAUTH_FALLBACK;
  const enableGoogleDeviceOAuthFallback =
    Boolean(googleDeviceOAuthClientId && googleDeviceOAuthClientSecret)
    && deviceOAuthFallbackSetting !== "false";
  if (webOAuthFallbackSetting === "true" && !googleWebOAuthClientId) {
    throw new Error("AURA_ENABLE_GOOGLE_WEB_OAUTH_FALLBACK=true requires AURA_GOOGLE_WEB_OAUTH_CLIENT_ID.");
  }
  if (deviceOAuthFallbackSetting === "true" && (!googleDeviceOAuthClientId || !googleDeviceOAuthClientSecret)) {
    throw new Error("AURA_ENABLE_GOOGLE_DEVICE_OAUTH_FALLBACK=true requires AURA_GOOGLE_DEVICE_OAUTH_CLIENT_ID and AURA_GOOGLE_DEVICE_OAUTH_CLIENT_SECRET.");
  }

  if (googleWebOAuthClientId) {
    if (!OAUTH_CLIENT_ID_PATTERN.test(googleWebOAuthClientId)) {
      throw new Error("AURA_GOOGLE_WEB_OAUTH_CLIENT_ID must be a real Google OAuth Web Client ID ending with .apps.googleusercontent.com.");
    }
    if (looksLikeExampleOAuthClientId(googleWebOAuthClientId)) {
      throw new Error("AURA_GOOGLE_WEB_OAUTH_CLIENT_ID points to an example value. Create a real Web OAuth Client ID in Google Cloud Console and use that value.");
    }
  }

  if (googleDeviceOAuthClientId) {
    if (!OAUTH_CLIENT_ID_PATTERN.test(googleDeviceOAuthClientId)) {
      throw new Error("AURA_GOOGLE_DEVICE_OAUTH_CLIENT_ID must be a real Google OAuth Device Client ID ending with .apps.googleusercontent.com.");
    }
    if (looksLikeExampleOAuthClientId(googleDeviceOAuthClientId)) {
      throw new Error("AURA_GOOGLE_DEVICE_OAUTH_CLIENT_ID points to an example value. Create a real TVs and Limited Input OAuth Client ID in Google Cloud Console and use that value.");
    }
  }

  return {
    plugins: [react(), localAudioDecoderSdkPlugin(), bundledAudioDecoderPlugin(), manifestBuildPlugin({
      clientId: googleOAuthClientId,
      extensionVersion,
      targetBrowser: resolvedTargetBrowser
    })],
    define: {
      __AURA_ENABLE_GOOGLE_WEB_OAUTH_FALLBACK__: JSON.stringify(enableGoogleWebOAuthFallback),
      __AURA_GOOGLE_WEB_OAUTH_CLIENT_ID__: JSON.stringify(enableGoogleWebOAuthFallback ? googleWebOAuthClientId : ""),
      __AURA_GOOGLE_WEB_OAUTH_REDIRECT_PATH__: JSON.stringify(googleWebOAuthRedirectPath),
      __AURA_ENABLE_GOOGLE_DEVICE_OAUTH_FALLBACK__: JSON.stringify(enableGoogleDeviceOAuthFallback),
      __AURA_GOOGLE_DEVICE_OAUTH_CLIENT_ID__: JSON.stringify(enableGoogleDeviceOAuthFallback ? googleDeviceOAuthClientId : ""),
      __AURA_GOOGLE_DEVICE_OAUTH_CLIENT_SECRET__: JSON.stringify(enableGoogleDeviceOAuthFallback ? googleDeviceOAuthClientSecret : ""),
      __AURA_TARGET_BROWSER__: JSON.stringify(resolvedTargetBrowser)
    },
    worker: { format: "es", plugins: () => [localAudioDecoderSdkPlugin()] },
    build: {
      rollupOptions: {
        input: {
          background: resolve(__dirname, "src/background.ts"),
          newtab: resolve(__dirname, "newtab.html"),
          popup: resolve(__dirname, "popup.html"),
          options: resolve(__dirname, "options.html")
        },
        output: {
          entryFileNames: (chunk) => (chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js")
        }
      },
      minify: false,
      cssMinify: true,
      sourcemap: false,
      emptyOutDir: true
    }
  };
});
