import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
});
