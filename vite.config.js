import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        "index-debug": resolve(__dirname, "index-debug.html"),
      },
    },
  },
});
