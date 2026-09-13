// Self-host PDF.js fonts/CMaps/decoders; never send source data to a CDN.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const assets = new Map();
for (const folder of ["cmaps", "standard_fonts", "wasm"]) {
  const root = new URL(`./node_modules/pdfjs-dist/${folder}/`, import.meta.url);
  for (const file of readdirSync(root, { withFileTypes: true })) {
    if (file.isFile()) assets.set(`pdf-assets/${folder}/${file.name}`, fileURLToPath(new URL(file.name, root)));
  }
}
export function pdfAssets() {
  return {
    name: "trialboard-pdf-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const key = (req.url ?? "").split("?")[0].replace(/^\//, "");
        const file = assets.get(key);
        if (!file) return next();
        res.setHeader("Content-Type", key.endsWith(".wasm") ? "application/wasm" : "application/octet-stream");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const [fileName, file] of assets) this.emitFile({ type: "asset", fileName, source: readFileSync(file) });
    },
  };
}
