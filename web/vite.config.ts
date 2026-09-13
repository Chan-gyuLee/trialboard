import { defineConfig } from "vite";
import { pdfAssets } from "./pdf-assets.mjs";

export default defineConfig({
  plugins: [pdfAssets()],
  server: {
    host: "127.0.0.1", port: 5173, strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: true } },
  },
});
