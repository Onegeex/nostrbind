import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// libauth uses top-level await, so target modern browsers.
export default defineConfig({
  plugins: [react()],
  build: { target: "esnext" },
  optimizeDeps: { esbuildOptions: { target: "esnext" } },
});
