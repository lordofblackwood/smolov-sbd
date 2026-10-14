import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
const base = process.env.BASE_PATH
  ? `/${process.env.BASE_PATH.replace(/^\/+|\/+$/g, "")}/`
  : "/";
export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icons/*.png", "icon.svg"],
      manifest: {
        id: `${base}smolov-sbd`,
        name: "Smolov SBD · Meet Prep",
        short_name: "Smolov SBD",
        description: "Modified Smolov Jr. — SBD Meet Prep",
        start_url: base,
        scope: base,
        display: "standalone",
        background_color: "#080c16",
        theme_color: "#080c16",
        icons: [
          {
            src: `${base}icons/icon-192.png`,
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: `${base}icons/icon-512.png`,
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: `${base}icons/maskable-512.png`,
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        cacheId: "smolov-sbd-shell",
        globPatterns: ["**/*.{html,js,css,png,svg,woff2}"],
        cleanupOutdatedCaches: true,
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/\/api\//],
        clientsClaim: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  test: { include: ["tests/**/*.test.{ts,js}"], environment: "node" },
} as Parameters<typeof defineConfig>[0]);
