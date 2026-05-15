import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const OAUTH_CLIENT_ID_PATTERN = /^[a-z0-9-]+\.apps\.googleusercontent\.com$/i;

function googleOAuthClientPlugin(clientId: string | undefined): Plugin {
  return {
    name: "aura-google-oauth-client",
    apply: "build",
    async closeBundle() {
      if (!clientId) return;
      if (!OAUTH_CLIENT_ID_PATTERN.test(clientId)) {
        throw new Error("AURA_GOOGLE_OAUTH_CLIENT_ID must look like 123-example.apps.googleusercontent.com.");
      }

      const manifestPath = resolve(__dirname, "dist", "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        oauth2?: { client_id?: string; scopes?: string[] };
      };
      manifest.oauth2 = {
        ...manifest.oauth2,
        client_id: clientId
      };
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      console.log("Injected Google OAuth Client ID into dist/manifest.json.");
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const googleOAuthClientId = env.AURA_GOOGLE_OAUTH_CLIENT_ID?.trim();

  return {
    plugins: [react(), googleOAuthClientPlugin(googleOAuthClientId)],
    build: {
      rollupOptions: {
        input: {
          newtab: resolve(__dirname, "newtab.html"),
          popup: resolve(__dirname, "popup.html"),
          options: resolve(__dirname, "options.html")
        }
      },
      minify: false,
      cssMinify: true,
      sourcemap: false,
      emptyOutDir: true
    }
  };
});
