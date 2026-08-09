import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    // Electron's sandboxed preload runtime uses its restricted CommonJS loader.
    build: {
      rollupOptions: {
        external: ["electron"],
        output: { format: "cjs" },
      },
    },
  },
  renderer: {
    plugins: [react()],
  },
});
