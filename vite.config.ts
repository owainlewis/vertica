import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // In development the API is a separate Node process; see `npm run dev`.
  server: { proxy: { "/api": "http://localhost:8787" } },
  build: { outDir: "dist" },
});
