import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    setupFiles: ["./src/renderer/test-setup.ts"],
    // Renderer tests cross promise and React scheduling boundaries. Keep their
    // assertions strict while allowing a loaded packaging host to make progress.
    testTimeout: 15_000,
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
