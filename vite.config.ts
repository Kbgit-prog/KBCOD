import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/",
  build: { outDir: "dist/admin", emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 900 },
  server: { proxy: { "/api": "http://localhost:3000" } },
});
