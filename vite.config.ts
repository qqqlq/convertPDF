import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import { resolve } from "path";
import manifest from "./src/manifest.json";

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        offscreen: resolve(__dirname, "src/offscreen/offscreen.html"),
      },
    },
  },
});
