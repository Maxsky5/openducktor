import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { Effect } from "effect";
import sharp from "sharp";
import { createArtifactImagePreviewAdapter } from "./artifact-image-preview-adapter";

const formats = ["png", "jpeg", "webp", "gif"] as const;
const image = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 4, background: "red" } });

describe("artifact image previews", () => {
  test.each(
    formats.flatMap((format) =>
      [`image/${format}`, `IMAGE/${format.toUpperCase()}`, `Image/${format.toUpperCase()}`].map(
        (mediaType) => [format, mediaType] as const,
      ),
    ),
  )(
    "passes through validated %s bytes with media type %s without changing the captured input",
    async (format, mediaType) => {
      const content = await image(12, 8).toFormat(format).toBuffer();
      const original = Buffer.from(content);
      const preview = await Effect.runPromise(
        createArtifactImagePreviewAdapter().previewArtifactImage({
          mediaType,
          content,
        }),
      );
      expect(preview).toMatchObject({
        state: "ready",
        mediaType: `image/${format}`,
        width: 12,
        height: 8,
        byteSize: original.length,
        dataBase64: original.toString("base64"),
      });
      expect(content).toEqual(original);
    },
  );

  test.each(formats)("converts oversized %s dimensions to a bounded preview", async (format) => {
    const content = await image(5000, 100).toFormat(format).toBuffer();
    const preview = await Effect.runPromise(
      createArtifactImagePreviewAdapter().previewArtifactImage({
        mediaType: `image/${format}`,
        content,
      }),
    );
    expect(preview.state).toBe("ready");
    if (preview.state !== "ready") throw new Error(preview.message);
    expect(preview.mediaType).toBe("image/webp");
    expect(preview.width).toBe(1024);
    expect(preview.height).toBe(20);
    expect(preview.byteSize).toBeLessThanOrEqual(2 * 1024 * 1024);
    const decoded = await sharp(Buffer.from(preview.dataBase64, "base64")).metadata();
    expect(decoded.width).toBe(1024);
  });

  test("converts a raster above the preview byte limit and rejects corrupt pixel data", async () => {
    const content = await sharp(randomBytes(1024 * 1024 * 3), {
      raw: { width: 1024, height: 1024, channels: 3 },
    })
      .png()
      .toBuffer();
    expect(content.length).toBeGreaterThan(2 * 1024 * 1024);
    const adapter = createArtifactImagePreviewAdapter();
    const preview = await Effect.runPromise(
      adapter.previewArtifactImage({ mediaType: "image/png", content }),
    );
    expect(preview.state).toBe("ready");
    if (preview.state !== "ready") throw new Error(preview.message);
    expect(preview.byteSize).toBeLessThanOrEqual(2 * 1024 * 1024);
    const corrupt = content.subarray(0, 100);
    expect(
      await Effect.runPromise(
        adapter.previewArtifactImage({ mediaType: "image/png", content: corrupt }),
      ),
    ).toMatchObject({ state: "failed" });
    expect(
      await Effect.runPromise(adapter.previewArtifactImage({ mediaType: "image/jpeg", content })),
    ).toMatchObject({ state: "failed" });
  });

  test.each(["gif", "webp"] as const)(
    "retains %s animation in pass-through and conversion",
    async (format) => {
      const adapter = createArtifactImagePreviewAdapter();
      for (const width of [20, 5000] as const) {
        const pixels = Buffer.concat([
          Buffer.alloc(width * 20 * 3, 255),
          Buffer.alloc(width * 20 * 3),
        ]);
        const content = await sharp(pixels, {
          raw: { width, height: 40, pageHeight: 20, channels: 3 },
        })
          .toFormat(format, { loop: 0, delay: [100, 200] })
          .toBuffer();
        const preview = await Effect.runPromise(
          adapter.previewArtifactImage({ mediaType: `image/${format}`, content }),
        );
        expect(preview.state).toBe("ready");
        if (preview.state !== "ready") throw new Error(preview.message);
        const decoded = await sharp(Buffer.from(preview.dataBase64, "base64"), {
          animated: true,
        }).metadata();
        expect(decoded.pages).toBe(2);
        expect(decoded.delay).toEqual([100, 200]);
        expect(decoded.pageHeight).toBe(preview.height);
      }
    },
  );

  test.each(["image/svg+xml", "IMAGE/SVG+XML", "Image/Svg+Xml"])(
    "renders SVG with media type %s without script execution or external image requests",
    async (mediaType) => {
      let requests = 0;
      const server = createServer((_request, response) => {
        requests++;
        response.end("unexpected");
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      try {
        const address = server.address();
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Node returns a union of socket paths and TCP addresses at this I/O boundary.
        if (!address || typeof address === "string") throw new Error("Expected a TCP listener.");
        const url = `http://127.0.0.1:${address.port}/secret`;
        const content = Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000"><script>fetch('${url}')</script><image href="${url}" width="2000" height="1000"/><image href="file:///etc/passwd" width="2000" height="1000"/><rect width="2000" height="1000" fill="red"/></svg>`,
        );
        const preview = await Effect.runPromise(
          createArtifactImagePreviewAdapter().previewArtifactImage({
            mediaType,
            content,
          }),
        );
        expect(preview).toMatchObject({
          state: "ready",
          mediaType: "image/png",
          width: 1024,
          height: 512,
        });
        expect(requests).toBe(0);
        if (preview.state !== "ready") throw new Error(preview.message);
        const { data } = await sharp(Buffer.from(preview.dataBase64, "base64"))
          .raw()
          .toBuffer({ resolveWithObject: true });
        expect([...data.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
      } finally {
        server.close();
        await once(server, "close");
      }
    },
  );

  test("keeps the pinned SVG renderer free of filesystem and network imports", async () => {
    const wasm = await readFile(new URL(import.meta.resolve("@resvg/resvg-wasm/index_bg.wasm")));
    const imports = WebAssembly.Module.imports(await WebAssembly.compile(wasm));
    expect(imports.every(({ module }) => module === "wbg")).toBe(true);
    const bindings = await readFile(new URL(import.meta.resolve("@resvg/resvg-wasm")), "utf8");
    const bindingBody = bindings
      .split("function __wbg_get_imports() {")[1]
      ?.split("function __wbg_init_memory")[0];
    expect(bindingBody).toBeDefined();
    expect(bindingBody).not.toMatch(
      /\b(?:fetch|XMLHttpRequest|WebSocket|require|import|eval|Function)\b/,
    );
  });

  test("renders SVG text with the bundled font", async () => {
    const preview = await Effect.runPromise(
      createArtifactImagePreviewAdapter().previewArtifactImage({
        mediaType: "image/svg+xml",
        content: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><text x="2" y="20">Hello</text></svg>',
        ),
      }),
    );
    if (preview.state !== "ready") throw new Error(preview.message);
    const { channels } = await sharp(Buffer.from(preview.dataBase64, "base64")).stats();
    expect(channels[3]?.sum).toBeGreaterThan(0);
  });

  test("bounds embedded SVG raster pixels before the SVG renderer decodes them", async () => {
    const adapter = createArtifactImagePreviewAdapter();
    const svg = (body: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${body}</svg>`;
    for (const [width, count] of [
      [5000, 1],
      [3000, 2],
    ] as const) {
      const png = await image(width, width).png().toBuffer();
      const embedded = `<image width="10" height="10" href="data&#58;image/png;base64,${png.toString("base64")}"/>`;
      const body =
        count === 1
          ? embedded
          : `<image width="10" height="10" href="data:image/svg+xml;base64,${Buffer.from(svg(embedded)).toString("base64")}"/>`.repeat(
              count,
            );
      const preview = await Effect.runPromise(
        adapter.previewArtifactImage({
          mediaType: "image/svg+xml",
          content: Buffer.from(svg(body)),
        }),
      );
      expect(preview.state).toBe("failed");
    }
    const png = await image(5, 5).png().toBuffer();
    const good = await Effect.runPromise(
      adapter.previewArtifactImage({
        mediaType: "image/svg+xml",
        content: Buffer.from(
          svg(
            `<image width="10" height="10" href="data:image/png;base64,${png.toString("base64")}"/>`,
          ),
        ),
      }),
    );
    expect(good.state).toBe("ready");
  });

  test("bounds nested SVG data and rejects entity declarations", async () => {
    const wrap = (child: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image width="10" height="10" href="data:image/svg+xml;base64,${Buffer.from(child).toString("base64")}"/></svg>`;
    let content =
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>';
    for (let depth = 0; depth < 9; depth++) content = wrap(content);
    const adapter = createArtifactImagePreviewAdapter();
    expect(
      await Effect.runPromise(
        adapter.previewArtifactImage({ mediaType: "image/svg+xml", content: Buffer.from(content) }),
      ),
    ).toMatchObject({ state: "failed" });
    expect(
      await Effect.runPromise(
        adapter.previewArtifactImage({
          mediaType: "image/svg+xml",
          content: Buffer.from(
            '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
          ),
        }),
      ),
    ).toMatchObject({ state: "failed" });
  });

  test("rejects excess input, decoded pixels, and concurrent jobs with an explicit failed preview", async () => {
    const adapter = createArtifactImagePreviewAdapter();
    const tooLarge = await Effect.runPromise(
      adapter.previewArtifactImage({
        mediaType: "image/png",
        content: Buffer.alloc(10 * 1024 * 1024 + 1),
      }),
    );
    expect(tooLarge).toMatchObject({
      state: "failed",
      message: "The image exceeds the 10 MiB preview input limit.",
    });
    const manyPixels = await image(4097, 4097).png().toBuffer();
    expect(
      await Effect.runPromise(
        adapter.previewArtifactImage({ mediaType: "image/png", content: manyPixels }),
      ),
    ).toMatchObject({ state: "failed" });
    const content = await image(20, 20).png().toBuffer();
    const previews = await Effect.runPromise(
      Effect.all(
        [0, 1, 2].map(() => adapter.previewArtifactImage({ mediaType: "image/png", content })),
        { concurrency: "unbounded" },
      ),
    );
    expect(previews.filter((preview) => preview.state === "ready")).toHaveLength(2);
    expect(previews).toContainEqual(
      expect.objectContaining({ state: "failed", message: "The image preview workers are busy." }),
    );
    expect(
      await Effect.runPromise(adapter.previewArtifactImage({ mediaType: "image/png", content })),
    ).toMatchObject({ state: "ready" });
  });
});
