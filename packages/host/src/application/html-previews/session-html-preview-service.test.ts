import { afterEach, describe, expect, test } from "bun:test";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ODT_HTML_PREVIEW_MAX_STORED_BYTES } from "@openducktor/contracts";
import { Effect } from "effect";
import { createNodeHtmlPreviewFilePort } from "../../adapters/node/filesystem-html-preview-file-port";
import { createNodeSessionHtmlPreviewStore } from "../../adapters/node/filesystem-session-html-preview-store";
import type { HtmlPreviewFilePort } from "../../ports/html-preview-file-port";
import type { RuntimeSessionOwner } from "../../ports/workspace-session-store-port";
import { repoConfigFixture } from "../../test-support/repo-config-fixture";
import { inlineLocalHtmlPreviewImages } from "./html-preview-image-inliner";
import { createSessionHtmlPreviewService } from "./session-html-preview-service";

const ONE_PIXEL_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082",
  "hex",
);

const cleanups = new Set<() => Promise<void>>();
afterEach(async () => {
  await Promise.all(Array.from(cleanups, (cleanup) => cleanup()));
  cleanups.clear();
});

const createHarness = async (owner: RuntimeSessionOwner) => {
  const dir = await mkdtemp(path.join(tmpdir(), "odt-html-preview-service-"));
  cleanups.add(() => rm(dir, { recursive: true, force: true }));
  const configDir = path.join(dir, "config");
  const repoDir = path.join(dir, "repo");
  const worktreeBase = path.join(configDir, "worktrees", "ws-1");
  const tempRoot = path.join(dir, "temp");
  const outsideDir = path.join(dir, "outside");
  await Promise.all([
    mkdir(configDir, { recursive: true }),
    mkdir(repoDir, { recursive: true }),
    mkdir(worktreeBase, { recursive: true }),
    mkdir(tempRoot, { recursive: true }),
    mkdir(outsideDir, { recursive: true }),
  ]);

  const store = createNodeSessionHtmlPreviewStore({ configDir });
  let nextId = 0;
  const service = createSessionHtmlPreviewService({
    store,
    filePort: createNodeHtmlPreviewFilePort({ blockedRoots: [configDir] }),
    managedCallers: {
      resolve: () => Effect.succeed(owner),
    },
    workspaceSettingsService: {
      getRepoConfig: (workspaceId) =>
        Effect.succeed(
          repoConfigFixture({
            workspaceId,
            workspaceName: "Workspace",
            repoPath: repoDir,
          }),
        ),
    },
    settingsConfig: {
      resolveConfiguredPath: (value) => value,
      defaultWorktreeBasePath: () => worktreeBase,
    },
    tempDir: tempRoot,
    createPreviewId: () => `11111111-1111-4111-8111-${String(++nextId).padStart(12, "0")}`,
  });

  return { dir, service, store, configDir, repoDir, worktreeBase, tempRoot, outsideDir };
};

describe("createSessionHtmlPreviewService", () => {
  test("stores inline HTML in the dedicated preview folder, reads it back, and removes it with the workspace", async () => {
    const { service, store, configDir, repoDir } = await createHarness({
      kind: "task",
      runtimeKind: "opencode",
      externalSessionId: "sess-1",
      taskId: "task-1",
      role: "build",
    });

    const html = "<!doctype html><main><h1>Ready</h1></main>";
    const published = await Effect.runPromise(
      service.publish({
        workspaceId: "ws-1",
        caller: { runtime: "opencode", runtimeSessionId: "sess-1" },
        title: "Release summary",
        source: { kind: "html", html },
      }),
    );

    const previewId = "11111111-1111-4111-8111-000000000001";
    const expectedSize = Buffer.byteLength(html, "utf8");
    expect(published).toEqual({
      htmlPreview: {
        previewId,
        title: "Release summary",
        byteSize: expectedSize,
      },
    });

    const storedPath = path.join(configDir, "session-html-previews", "ws-1", `${previewId}.html`);
    expect(await readFile(storedPath, "utf8")).toBe(html);

    const loaded = await Effect.runPromise(
      service.read({ workspaceId: "ws-1", repoPath: repoDir, previewId }),
    );
    expect(loaded).toEqual({ previewId, html, byteSize: expectedSize });

    await Effect.runPromise(store.removeWorkspace("ws-1"));
    const afterRemove = await Effect.runPromise(
      Effect.flip(service.read({ workspaceId: "ws-1", repoPath: repoDir, previewId })),
    );
    expect(afterRemove._tag).toBe("HostResourceError");
  });

  test("publishes an HTML file from the workspace or worktree and inlines local PNG and SVG images while leaving script literals, quoted decoys, and root-relative URLs intact", async () => {
    const { service, repoDir, worktreeBase, tempRoot } = await createHarness({
      kind: "workspace",
      runtimeKind: "opencode",
      externalSessionId: "chat-1",
      sessionId: "chat-1",
      archived: false,
    });
    const pngPath = path.join(repoDir, "chart.png");
    const ampPngPath = path.join(repoDir, "a&b.png");
    const svgPath = path.join(tempRoot, "icon.svg");
    const htmlPath = path.join(worktreeBase, "report.html");
    await writeFile(pngPath, ONE_PIXEL_PNG);
    await writeFile(ampPngPath, ONE_PIXEL_PNG);
    await writeFile(
      svgPath,
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
    );
    const escapedAmpUrl = pathToFileURL(ampPngPath).href.replaceAll("&", "&amp;");
    await writeFile(
      htmlPath,
      `<!doctype html><html><head><link rel="icon" href="/favicon.ico" /><style>.hero{background:url("${pngPath}")}</style></head><body><div title='img src="file:///missing-decoy.png"' data-snippet='src="${pngPath}"'></div><img alt="x"src="${pngPath}" /><img src="${escapedAmpUrl}" /><img src="/assets/logo.png" /><img src="${pathToFileURL(svgPath).href}" /><script>const untouched = "${pngPath}";</script></body></html>`,
    );

    const published = await Effect.runPromise(
      service.publish({
        workspaceId: "ws-1",
        caller: { runtime: "opencode", runtimeSessionId: "chat-1" },
        title: "File report",
        source: { kind: "path", path: htmlPath },
      }),
    );
    const loaded = await Effect.runPromise(
      service.read({
        workspaceId: "ws-1",
        repoPath: repoDir,
        previewId: published.htmlPreview.previewId,
      }),
    );

    const pngDataUri = `data:image/png;base64,${ONE_PIXEL_PNG.toString("base64")}`;
    expect(loaded.html).toContain(`background:url("${pngDataUri}")`);
    expect(loaded.html).toContain(`alt="x"src="${pngDataUri}"`);
    expect(loaded.html).not.toContain("&amp;b.png");
    expect(loaded.html).toContain('src="data:image/svg+xml;base64,');
    expect(loaded.html).toContain('href="/favicon.ico"');
    expect(loaded.html).toContain('src="/assets/logo.png"');
    // Decoy text inside unrelated quoted attributes and script string literals must stay untouched.
    expect(loaded.html).toContain(`title='img src="file:///missing-decoy.png"'`);
    expect(loaded.html).toContain(`data-snippet='src="${pngPath}"'`);
    expect(loaded.html).toContain(`const untouched = "${pngPath}";`);
  });

  test.each(["file document", "file fragment", "inline fragment"] as const)(
    "embeds relative images from %s input",
    async (input) => {
      const { service, repoDir, tempRoot } = await createHarness({
        kind: "workspace",
        runtimeKind: "opencode",
        externalSessionId: "chat-1",
        sessionId: "chat-1",
        archived: false,
      });
      const fragment =
        '<!-- <base href="https://example.com/"> --><style>.picture{background:url(before.png)}</style><img class="picture" src="before.png" srcset="data:image/svg+xml,%3Csvg%3Edecoy.png 1x, ./after%20sample.png 2x"><img src="./after%20sample.png">';
      const html = input === "file document" ? `<!doctype html>${fragment}` : fragment;
      const htmlPath = path.join(tempRoot, "compare.html");
      await writeFile(htmlPath, html);
      await writeFile(path.join(tempRoot, "before.png"), ONE_PIXEL_PNG);
      await writeFile(path.join(tempRoot, "after sample.png"), ONE_PIXEL_PNG);

      const { htmlPreview } = await Effect.runPromise(
        service.publish({
          workspaceId: "ws-1",
          caller: { runtime: "opencode", runtimeSessionId: "chat-1" },
          title: "Comparison",
          source:
            input === "inline fragment"
              ? { kind: "html", html, baseDir: tempRoot }
              : { kind: "path", path: htmlPath },
        }),
      );
      const loaded = await Effect.runPromise(
        service.read({ workspaceId: "ws-1", repoPath: repoDir, previewId: htmlPreview.previewId }),
      );
      const png = `data:image/png;base64,${ONE_PIXEL_PNG.toString("base64")}`;
      expect(loaded.html).toContain(`background:url(${png})`);
      expect(loaded.html).toContain(`srcset="data:image/svg+xml,%3Csvg%3Edecoy.png 1x, ${png} 2x"`);
      expect(loaded.html.split(`src="${png}"`)).toHaveLength(3);
    },
  );

  test("reports missing base directories and rejects relative image paths outside allowed roots", async () => {
    const { service, tempRoot, outsideDir } = await createHarness({
      kind: "workspace",
      runtimeKind: "opencode",
      externalSessionId: "chat-1",
      sessionId: "chat-1",
      archived: false,
    });
    const publish = (html: string, baseDir?: string) =>
      Effect.runPromise(
        Effect.flip(
          service.publish({
            workspaceId: "ws-1",
            caller: { runtime: "opencode", runtimeSessionId: "chat-1" },
            title: "Comparison",
            source: { kind: "html", html, baseDir },
          }),
        ),
      );
    await writeFile(path.join(outsideDir, "outside.png"), ONE_PIXEL_PNG);
    const withoutBase = await publish('<img src="before.png">');
    expect(withoutBase.message).toContain("before.png");
    expect(withoutBase.message).toContain("baseDir");
    const escaped = await publish('<img src="../outside/outside.png">', tempRoot);
    expect(escaped.message).toContain("../outside/outside.png");
    expect(escaped.message).toContain("Could not inline");
    const outsideBase = await publish('<img src="outside.png">', outsideDir);
    expect(outsideBase).toMatchObject({ _tag: "HostValidationError", field: "baseDir" });
  });

  test("keeps static image URLs that resolve against an HTTPS base", async () => {
    const { service, repoDir } = await createHarness({
      kind: "workspace",
      runtimeKind: "opencode",
      externalSessionId: "chat-1",
      sessionId: "chat-1",
      archived: false,
    });
    const html =
      '<!doctype html><html><head><base href="https://example.com/"></head><body><img src="chart.png"></body></html>';
    const { htmlPreview } = await Effect.runPromise(
      service.publish({
        workspaceId: "ws-1",
        caller: { runtime: "opencode", runtimeSessionId: "chat-1" },
        title: "Remote chart",
        source: { kind: "html", html },
      }),
    );
    const loaded = await Effect.runPromise(
      service.read({ workspaceId: "ws-1", repoPath: repoDir, previewId: htmlPreview.previewId }),
    );
    expect(loaded.html).toBe(html);
  });

  test("rejects spoofed images, blocked configDir paths, out-of-workspace files, symlinks, hardlinks, non-HTML files, and viewport heights", async () => {
    const { service, configDir, repoDir, outsideDir } = await createHarness({
      kind: "workspace",
      runtimeKind: "opencode",
      externalSessionId: "chat-1",
      sessionId: "chat-1",
      archived: false,
    });
    const caller = { runtime: "opencode" as const, runtimeSessionId: "chat-1" };

    const fakePng = path.join(repoDir, "fake.png");
    await writeFile(fakePng, "not a png file");

    const realPng = path.join(repoDir, "real.png");
    await writeFile(realPng, ONE_PIXEL_PNG);
    const hardlinkPng = path.join(repoDir, "hard.png");
    await link(realPng, hardlinkPng);

    const outsideHtml = path.join(outsideDir, "saved.html");
    await writeFile(outsideHtml, "<!doctype html><p>outside</p>");
    const outsidePng = path.join(outsideDir, "secret.png");
    await writeFile(outsidePng, ONE_PIXEL_PNG);

    const blockedHtml = path.join(configDir, "secret.html");
    await writeFile(blockedHtml, "<!doctype html><p>secret</p>");

    const realHtml = path.join(repoDir, "real.html");
    await writeFile(realHtml, "<!doctype html><p>ok</p>");
    const symlinkHtml = path.join(repoDir, "link.html");
    await symlink(realHtml, symlinkHtml);
    const hardlinkHtml = path.join(repoDir, "hard.html");
    await link(realHtml, hardlinkHtml);

    const notHtml = path.join(repoDir, "notes.html");
    await writeFile(notHtml, "plain text without html header");

    const errors = await Effect.runPromise(
      Effect.all([
        Effect.flip(
          service.publish({
            workspaceId: "ws-1",
            caller,
            title: "Spoofed",
            source: { kind: "html", html: `<img src="${fakePng}" />` },
          }),
        ),
        Effect.flip(
          service.publish({
            workspaceId: "ws-1",
            caller,
            title: "Blocked",
            source: { kind: "path", path: blockedHtml },
          }),
        ),
        Effect.flip(
          service.publish({
            workspaceId: "ws-1",
            caller,
            title: "Outside HTML",
            source: { kind: "path", path: outsideHtml },
          }),
        ),
        Effect.flip(
          service.publish({
            workspaceId: "ws-1",
            caller,
            title: "Outside file:// image",
            source: { kind: "html", html: `<img src="${pathToFileURL(outsidePng).href}" />` },
          }),
        ),
        Effect.flip(
          service.publish({
            workspaceId: "ws-1",
            caller,
            title: "Hardlinked image",
            source: { kind: "html", html: `<img src="${hardlinkPng}" />` },
          }),
        ),
        Effect.flip(
          service.publish({
            workspaceId: "ws-1",
            caller,
            title: "Symlink",
            source: { kind: "path", path: symlinkHtml },
          }),
        ),
        Effect.flip(
          service.publish({
            workspaceId: "ws-1",
            caller,
            title: "Hardlink",
            source: { kind: "path", path: hardlinkHtml },
          }),
        ),
        Effect.flip(
          service.publish({
            workspaceId: "ws-1",
            caller,
            title: "Plain text",
            source: { kind: "path", path: notHtml },
          }),
        ),
        Effect.flip(
          service.publish({
            workspaceId: "ws-1",
            caller,
            title: "Tailwind vh",
            source: { kind: "html", html: '<div class="min-h-screen">tall</div>' },
          }),
        ),
      ]),
    );

    expect(errors.map((error) => error._tag)).toEqual([
      "HostValidationError",
      "HostValidationError",
      "HostValidationError",
      "HostValidationError",
      "HostValidationError",
      "HostValidationError",
      "HostValidationError",
      "HostValidationError",
      "HostValidationError",
    ]);
    expect(errors[0]?.message).toContain("image format");
    expect(errors[1]?.message).toContain("config directory");
    expect(errors[2]?.message).toContain("outside the workspace");
    expect(errors[3]?.message).toContain("Could not inline local image");
    expect(errors[4]?.message).toContain("Could not inline local image");
    expect(errors[5]?.message).toContain("symlink");
    expect(errors[6]?.message).toContain("hard-linked");
    expect(errors[7]?.message).toContain("HTML document");
    expect(errors[8]?.message).toContain("min-h-screen");
  });

  test("classifies missing files and broken symlinks under symlinked allowed roots accurately", async () => {
    const { dir, configDir, tempRoot } = await createHarness({
      kind: "workspace",
      runtimeKind: "opencode",
      externalSessionId: "chat-1",
      sessionId: "chat-1",
      archived: false,
    });
    // Simulates macOS `/var/folders/...` -> `/private/var/folders/...` where the allowed root
    // passes through a symlinked directory.
    const symlinkedTemp = path.join(dir, "temp-alias");
    await symlink(tempRoot, symlinkedTemp);

    const filePort = createNodeHtmlPreviewFilePort({ blockedRoots: [configDir] });
    const missingHtml = path.join(symlinkedTemp, "missing.html");
    const missingHtmlErr = await Effect.runPromise(
      Effect.flip(filePort.readHtmlFile(missingHtml, [symlinkedTemp])),
    );
    expect(missingHtmlErr.message).toContain("not a readable HTML document");
    expect(missingHtmlErr.message).not.toContain("outside the workspace");

    const missingPng = path.join(symlinkedTemp, "missing.png");
    const missingImageErr = await Effect.runPromise(
      Effect.flip(
        inlineLocalHtmlPreviewImages(`<img src="${missingPng}" />`, [symlinkedTemp], filePort),
      ),
    );
    expect(missingImageErr.message).toContain("Could not inline local image");
    expect(missingImageErr.message).toContain(missingPng);
  });

  test("rewrites local image URLs according to HTML, CSS, and file URL syntax", async () => {
    const { tempRoot } = await createHarness({
      kind: "workspace",
      runtimeKind: "opencode",
      externalSessionId: "chat-1",
      sessionId: "chat-1",
      archived: false,
    });
    const port = createNodeHtmlPreviewFilePort({ blockedRoots: [] });
    await writeFile(path.join(tempRoot, "chart.png"), ONE_PIXEL_PNG);
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><view id="detail" viewBox="0 0 5 5"/></svg>';
    const svgPath = path.join(tempRoot, "icon.svg");
    await writeFile(svgPath, svg);
    const hashInFilename = path.join(tempRoot, "icon.svg#literal.svg");
    await writeFile(hashInFilename, svg);
    const png = `data:image/png;base64,${ONE_PIXEL_PNG.toString("base64")}`;
    const svgUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    const inline = (html: string) =>
      Effect.runPromise(inlineLocalHtmlPreviewImages(html, [tempRoot], port, tempRoot));
    const cssText = '.example::after{content:"url(missing.png) url(chart.png)"}';
    expect(await inline(`<style>${cssText}.pic{background:url(chart.png)}</style>`)).toBe(
      `<style>${cssText}.pic{background:url(${png})}</style>`,
    );
    expect(await inline('<img style="background:url(&quot;chart.png&quot;)">')).toBe(
      `<img style="background:url(&quot;${png}&quot;)">`,
    );
    expect(await inline('<img srcset="chart.png&#44; ./chart.png">')).toBe(
      `<img srcset="${png}&#44; ${png}">`,
    );
    const https = '<img src="https&colon;//example.com/chart.png">';
    expect(await inline(https)).toBe(https);
    expect(
      await inline(
        '<img src="chart%2Epng" srcset="chart%2Epng" style="background:url(chart%2Epng)">',
      ),
    ).toBe(`<img src="${png}" srcset="${png}" style="background:url(${png})">`);
    expect(await inline('<img src="icon.svg#detail">')).toBe(`<img src="${svgUri}#detail">`);
    expect(await inline(`<img src="${svgPath}#detail">`)).toBe(`<img src="${svgUri}#detail">`);
    expect(await inline(`<img src="${hashInFilename}">`)).toBe(`<img src="${svgUri}">`);
  });

  test("charges the bytes of the original image reference at the stored size limit", async () => {
    const { tempRoot } = await createHarness({
      kind: "workspace",
      runtimeKind: "opencode",
      externalSessionId: "chat-1",
      sessionId: "chat-1",
      archived: false,
    });
    const port = createNodeHtmlPreviewFilePort({ blockedRoots: [] });
    await writeFile(path.join(tempRoot, "chart.png"), ONE_PIXEL_PNG);
    const encoded = `<img src="data:image/png;base64,${ONE_PIXEL_PNG.toString("base64")}">`;
    const padding = " ".repeat(ODT_HTML_PREVIEW_MAX_STORED_BYTES - Buffer.byteLength(encoded));
    const inline = (html: string) => inlineLocalHtmlPreviewImages(html, [tempRoot], port, tempRoot);
    for (const source of ["chart.png", " chart.png "]) {
      const result = await Effect.runPromise(inline(`<img src="${source}">${padding}`));
      expect(Buffer.byteLength(result)).toBe(ODT_HTML_PREVIEW_MAX_STORED_BYTES);
      expect(result.startsWith(encoded)).toBe(true);
    }
    const oversized = await Effect.runPromise(
      Effect.flip(inline(`<img src=" chart.png ">${padding} `)),
    );
    expect(oversized.message).toContain("exceed");
  });

  test("short-circuits before reading remaining images once the 25 MiB stored size budget is exceeded", async () => {
    const readPaths: string[] = [];
    const chunkSize = 8 * 1024 * 1024;
    const pngChunk = Buffer.alloc(chunkSize);
    ONE_PIXEL_PNG.copy(pngChunk, 0);

    const stubPort: HtmlPreviewFilePort = {
      ...createNodeHtmlPreviewFilePort({ blockedRoots: [] }),
      readLocalImage: (filePath) => {
        readPaths.push(filePath);
        return Effect.succeed({ kind: "ok", bytes: pngChunk, size: chunkSize });
      },
    };

    const images = Array.from({ length: 12 }, (_, idx) => `<img src="/repo/img-${idx}.png" />`);
    const error = await Effect.runPromise(
      Effect.flip(inlineLocalHtmlPreviewImages(images.join(""), ["/repo"], stubPort)),
    );
    expect(error._tag).toBe("HostValidationError");
    expect(error.message).toContain(
      `${(ODT_HTML_PREVIEW_MAX_STORED_BYTES / (1024 * 1024)).toFixed(1)} MiB`,
    );
    expect(readPaths.length).toBeLessThan(images.length);
  });
});
