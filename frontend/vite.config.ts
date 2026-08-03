import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  // Mantém os caminhos relativos usados atualmente pela aplicação.
  base: "./",

  build: {
    // A Vercel está configurada para procurar frontend/dist.
    outDir: "dist",

    // Agora é seguro limpar, pois dist será exclusivamente uma pasta de build.
    emptyOutDir: true,

    // Preserva o nome atual da pasta dos assets gerados.
    assetsDir: "react-assets",

    // Preserva a estrutura multipágina atual.
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        auth: resolve(__dirname, "auth.html"),
        musics: resolve(__dirname, "musics.html"),
      },
    },
  },

  // Usado somente no desenvolvimento local.
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
});