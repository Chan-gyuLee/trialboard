// Read pinned public originals and render QA images; never modify the PDFs.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPages } from "../src/pdf-extract.ts";

const output = new URL("../../output/pdf-qa/", import.meta.url);
mkdirSync(output, { recursive: true });
for (const [hash, page, term, name] of [
  ["2a8afcae85c9e37576979af49571a1f87a2baa00aff6c4f43270b00ec20da9d9", 4, "960", "fda-letter-p4"],
  ["13b25858865d8b26db65f51cfa05eaaeed69094a7bc33099b75e5d16d248d0e3", 9, "dosage", "fda-guidance-p9"],
]) {
  const bytes = new Uint8Array(readFileSync(new URL(`../../data/snapshots/${hash}.pdf`, import.meta.url)));
  if (createHash("sha256").update(bytes).digest("hex") !== hash) throw new Error("Pinned PDF changed");
  const task = getDocument({ data: bytes, stopAtErrors: true, useSystemFonts: false, verbosity: 0,
    standardFontDataUrl: fileURLToPath(new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url)) });
  try {
    const pdf = await task.promise;
    const pages = await extractPages(pdf);
    const span = pages[page - 1].spans.find(s => s.text.toLowerCase().includes(term) && s.box);
    if (!span) throw new Error("QA anchor missing");
    const p = await pdf.getPage(page), viewport = p.getViewport({ scale: 1.5 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    await p.render({ canvas: null, canvasContext: context, viewport }).promise;
    const b = span.box;
    context.fillStyle = "rgba(251,200,72,0.3)";
    context.fillRect(b.x * viewport.width, b.y * viewport.height, b.width * viewport.width, b.height * viewport.height);
    context.strokeStyle = "#c68a18"; context.lineWidth = 1;
    context.strokeRect(b.x * viewport.width, b.y * viewport.height, b.width * viewport.width, b.height * viewport.height);
    writeFileSync(new URL(`${name}.png`, output), canvas.toBuffer("image/png"));
    console.log(JSON.stringify({ name, pages: pages.length, page, quote: span.text, box: b }));
  } finally { await task.destroy(); }
}
