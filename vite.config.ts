import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./app", import.meta.url)) } },
  // In development the API is a separate Node process; see `npm run dev`.
  server: { proxy: { "/api": "http://localhost:8787" } },
  build: { outDir: "dist" },
});
