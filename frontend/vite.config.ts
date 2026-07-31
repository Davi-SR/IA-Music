import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: resolve(__dirname, "../Front/glass-effect2"),
    emptyOutDir: false,
    assetsDir: "react-assets",
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        auth: resolve(__dirname, "auth.html"),
        musics: resolve(__dirname, "musics.html"),

      },
    },
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
});
