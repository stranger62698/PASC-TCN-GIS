import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  root: "static-src",
  publicDir: "../public",
  plugins: [react()],
  server: { fs: { allow: [".."] } },
  resolve: {
    alias: {
      "next/link": fileURLToPath(new URL("./static-src/shims/next-link.tsx", import.meta.url)),
      "next/navigation": fileURLToPath(new URL("./static-src/shims/next-navigation.ts", import.meta.url)),
      "next/dynamic": fileURLToPath(new URL("./static-src/shims/next-dynamic.tsx", import.meta.url)),
    },
  },
  build: {
    outDir: "../static-dist",
    emptyOutDir: true,
    target: "es2020",
    rollupOptions: process.env.VITE_FLAT_OUTPUT === "true" ? {
      output: {
        entryFileNames: "[name]-[hash].js",
        chunkFileNames: "[name]-[hash].js",
        assetFileNames: "[name]-[hash][extname]",
      },
    } : undefined,
  },
});
