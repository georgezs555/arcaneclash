import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Point straight at the engine source so Vite transpiles/HMRs it like app code.
      "@arcaneclash/engine": fileURLToPath(
        new URL("../engine/src/index.ts", import.meta.url),
      ),
    },
  },
  server: { port: 5173, host: true },
});
