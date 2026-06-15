import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const OAUTH_CLIENT_ID_PATTERN = /^[a-z0-9-]+\.apps\.googleusercontent\.com$/i;
const EXAMPLE_OAUTH_CLIENT_IDS = new Set([
  "123-example.apps.googleusercontent.com",
  "1234567890-abcdef.apps.googleusercontent.com"
]);

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

function googleOAuthClientPlugin(clientId: string | undefined): Plugin {
  return {
    name: "aura-google-oauth-client",
    apply: "build",
    async closeBundle() {
      if (!clientId) return;
      const normalizedClientId = normalizeOAuthClientId(clientId);
      if (!OAUTH_CLIENT_ID_PATTERN.test(normalizedClientId)) {
        throw new Error("AURA_GOOGLE_OAUTH_CLIENT_ID must be a real Google OAuth Client ID ending with .apps.googleusercontent.com.");
      }
      if (looksLikeExampleOAuthClientId(normalizedClientId)) {
        throw new Error("AURA_GOOGLE_OAUTH_CLIENT_ID points to an example value. Create a real OAuth Client ID in Google Cloud Console and use that value.");
      }

      const manifestPath = resolve(__dirname, "dist", "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        oauth2?: { client_id?: string; scopes?: string[] };
      };
      manifest.oauth2 = {
        ...manifest.oauth2,
        client_id: normalizedClientId
      };
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      console.log("Injected Google OAuth Client ID into dist/manifest.json.");
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const googleOAuthClientId = env.AURA_GOOGLE_OAUTH_CLIENT_ID?.trim();
  const storeBuild = process.env.AURA_STORE_BUILD === "true" || env.AURA_STORE_BUILD === "true";
  const googleWebOAuthClientId = storeBuild
    ? process.env.AURA_GOOGLE_WEB_OAUTH_CLIENT_ID?.trim() ?? ""
    : env.AURA_GOOGLE_WEB_OAUTH_CLIENT_ID?.trim() ?? "";
  const enableGoogleWebOAuthFallback =
    Boolean(googleWebOAuthClientId) && env.AURA_ENABLE_GOOGLE_WEB_OAUTH_FALLBACK !== "false";
  const googleWebOAuthRedirectPath = enableGoogleWebOAuthFallback
    ? (storeBuild ? "" : env.AURA_GOOGLE_WEB_OAUTH_REDIRECT_PATH?.trim() ?? "")
    : "";

  if (enableGoogleWebOAuthFallback && !googleWebOAuthClientId) {
    throw new Error("AURA_ENABLE_GOOGLE_WEB_OAUTH_FALLBACK=true requires AURA_GOOGLE_WEB_OAUTH_CLIENT_ID.");
  }

  if (googleWebOAuthClientId) {
    if (!OAUTH_CLIENT_ID_PATTERN.test(googleWebOAuthClientId)) {
      throw new Error("AURA_GOOGLE_WEB_OAUTH_CLIENT_ID must be a real Google OAuth Web Client ID ending with .apps.googleusercontent.com.");
    }
    if (looksLikeExampleOAuthClientId(googleWebOAuthClientId)) {
      throw new Error("AURA_GOOGLE_WEB_OAUTH_CLIENT_ID points to an example value. Create a real Web OAuth Client ID in Google Cloud Console and use that value.");
    }
  }

  return {
    plugins: [react(), googleOAuthClientPlugin(googleOAuthClientId)],
    define: {
      __AURA_ENABLE_GOOGLE_WEB_OAUTH_FALLBACK__: JSON.stringify(enableGoogleWebOAuthFallback),
      __AURA_GOOGLE_WEB_OAUTH_CLIENT_ID__: JSON.stringify(enableGoogleWebOAuthFallback ? googleWebOAuthClientId : ""),
      __AURA_GOOGLE_WEB_OAUTH_REDIRECT_PATH__: JSON.stringify(googleWebOAuthRedirectPath)
    },
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
