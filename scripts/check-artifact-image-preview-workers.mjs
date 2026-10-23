import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { checkWorkerBundles } from "./worker-bundle-checks.mjs";

const workerPath = process.argv[2];
if (!workerPath) {
  checkWorkerBundles(import.meta.url, "artifact-image-preview-worker.js");
} else {
  assert.match(await readFile(workerPath, "utf8"), /SIL OPEN FONT LICENSE/);
  const sharp = createRequire(new URL("../packages/host/package.json", import.meta.url))("sharp");
  const send = async (input) => {
    const worker = new Worker(pathToFileURL(workerPath));
    try {
      return await new Promise((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
        worker.once("exit", (code) => reject(new Error(`Preview worker exited: ${code}`)));
        worker.postMessage(input);
      });
    } finally {
      await worker.terminate();
    }
  };
  for (const format of ["png", "jpeg", "webp", "gif"]) {
    const content = await sharp({ create: { width: 8, height: 4, channels: 4, background: "red" } })
      .toFormat(format)
      .toBuffer();
    const result = await send({ mediaType: `image/${format}`, content });
    assert.equal(result.state, "ready");
    assert.equal(result.dataBase64, content.toString("base64"));
  }
  const svg = await send({
    mediaType: "image/svg+xml",
    content: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><text x="2" y="20">Hello</text></svg>',
    ),
  });
  assert.equal(svg.state, "ready");
  assert.equal(svg.mediaType, "image/png");
  assert.equal(svg.width, 100);
  assert.equal(svg.height, 40);
  const { channels } = await sharp(Buffer.from(svg.dataBase64, "base64")).stats();
  assert.ok(channels[3].sum > 0, "The bundled font must render SVG text.");
  console.log(
    `Artifact preview worker passed: ${process.versions.electron ? "Electron" : process.versions.bun ? "Bun" : "Node"} ${workerPath}`,
  );
}
