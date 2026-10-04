import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { createBrowserRuntimeConfigState } from "./browser-runtime-config-state";
import { runWebBoundary } from "./effect/web-errors";
import { request as httpRequest } from "./node-http-test-client";
import { RUNTIME_CONFIG_PATH } from "./runtime-config";
import { startStaticFrontendServerEffect } from "./static-frontend-server";

const script = Buffer.from("export const value = 'first build';\n".repeat(100));
const hashedName = (bytes: Buffer): string =>
  `/assets/app-${createHash("sha256").update(bytes).digest("hex").slice(0, 8)}.js`;
const scriptPath = hashedName(script);
const cssPath = "/assets/style-Ab_c-D12.css";
const css = Buffer.from("body { color: red; }\n".repeat(100));
const html = `<html><script src="${scriptPath}"></script></html>`;
const decodedBody = (response: {
  headers: import("node:http").IncomingHttpHeaders;
  body: Buffer;
}): Buffer =>
  response.headers["content-encoding"] === "gzip" ? gunzipSync(response.body) : response.body;

const withServer = async (
  check: (fixture: Awaited<ReturnType<typeof createFixture>>) => Promise<void>,
) => {
  const fixture = await createFixture();
  try {
    await check(fixture);
  } finally {
    await fixture.server.close();
    await rm(fixture.packageRoot, { recursive: true, force: true });
  }
};

const createFixture = async () => {
  const packageRoot = await mkdtemp(path.join(tmpdir(), "odt-static-http-"));
  const staticRoot = path.join(packageRoot, "dist/web-shell");
  await mkdir(path.join(staticRoot, "assets"), { recursive: true });
  await writeFile(path.join(staticRoot, "index.html"), html);
  await writeFile(path.join(staticRoot, scriptPath), script);
  await writeFile(path.join(staticRoot, cssPath), css);
  await writeFile(path.join(staticRoot, "assets/app.js"), "unhashed first");
  await writeFile(path.join(staticRoot, "assets/page-Ab_c-D12.html"), "hash-like HTML");
  await writeFile(path.join(staticRoot, "favicon.svg"), "<svg />");
  await writeFile(path.join(packageRoot, "secret.txt"), "outside the shell");
  const config = createBrowserRuntimeConfigState();
  config.publish('{"backendUrl":"http://127.0.0.1:1","appToken":"first"}');
  const server = await runWebBoundary(
    startStaticFrontendServerEffect({ packageRoot, frontendPort: 0 }, config),
  );
  const request = (requestPath: string, headers: Record<string, string> = {}, method = "GET") =>
    httpRequest(server.port, requestPath, headers, method);
  return { config, packageRoot, staticRoot, server, request };
};

test("validates HTML and unhashed files against their current bytes", () =>
  withServer(async ({ staticRoot, request }) => {
    for (const filePath of [
      "/",
      "/tasks/example",
      "/assets/app.js",
      "/favicon.svg",
      "/assets/page-Ab_c-D12.html",
    ]) {
      const first = await request(filePath);
      assert.equal(first.status, 200);
      assert.equal(first.headers["cache-control"], "public, max-age=0, must-revalidate");
      assert.ok(first.headers.etag);
      for (const condition of [first.headers.etag, `"other,tag", W/${first.headers.etag}`, "*"]) {
        const validated = await request(filePath, { "If-None-Match": condition });
        assert.equal(validated.status, 304);
        assert.equal(validated.body.length, 0);
        assert.equal(validated.headers.etag, first.headers.etag);
        assert.equal(validated.headers["cache-control"], first.headers["cache-control"]);
      }
      const head = await request(filePath, {}, "HEAD");
      assert.equal(head.status, 200);
      assert.equal(head.body.length, 0);
      assert.equal(head.headers.etag, first.headers.etag);
      assert.equal(Number(head.headers["content-length"]), first.body.length);
      assert.equal((await request(filePath, { "If-None-Match": '"missing"' })).status, 200);
    }
    for (const filePath of ["/index.html", "/assets/app.js"]) {
      const first = await request(filePath);
      const diskPath = path.join(staticRoot, filePath);
      const oldStat = await stat(diskPath);
      const updated = Buffer.from(first.body);
      updated[0] = updated[0] === 65 ? 66 : 65;
      await writeFile(diskPath, updated);
      await utimes(diskPath, oldStat.atime, oldStat.mtime);
      const changed = await request(filePath, { "If-None-Match": first.headers.etag ?? "" });
      assert.equal(changed.status, 200);
      assert.notEqual(changed.headers.etag, first.headers.etag);
      assert.deepEqual(changed.body, updated);
      assert.equal(
        (await request(filePath, { "If-None-Match": changed.headers.etag ?? "" })).status,
        304,
      );
    }
  }));

test("serves hashed assets with immutable caching and cache validation", () =>
  withServer(async ({ request }) => {
    for (const [filePath, bytes, contentType] of [
      [scriptPath, script, "text/javascript; charset=utf-8"],
      [cssPath, css, "text/css; charset=utf-8"],
    ] as const) {
      const first = await request(filePath, { "Accept-Encoding": "gzip" });
      assert.equal(first.status, 200);
      assert.deepEqual(decodedBody(first), bytes);
      assert.equal(first.headers["content-type"], contentType);
      assert.equal(first.headers["content-encoding"], "gzip");
      assert.equal(first.headers.vary, "Accept-Encoding");
      assert.ok(first.body.length < bytes.length / 2);
      assert.equal(first.headers["cache-control"], "public, max-age=31536000, immutable");
      assert.equal(first.headers["content-length"], undefined);
      const identity = await request(filePath);
      assert.deepEqual(identity.body, bytes);
      assert.equal(identity.headers["content-encoding"], undefined);
      assert.equal(identity.headers.vary, "Accept-Encoding");
      assert.equal(Number(identity.headers["content-length"]), bytes.length);
      const validated = await request(filePath, {
        "If-None-Match": first.headers.etag ?? "",
        "Accept-Encoding": "gzip",
      });
      assert.equal(validated.status, 304);
      assert.equal(validated.body.length, 0);
      assert.equal(validated.headers.etag, first.headers.etag);
      assert.equal(validated.headers["cache-control"], first.headers["cache-control"]);
      assert.equal(validated.headers.vary, first.headers.vary);
      const head = await request(filePath, { "Accept-Encoding": "gzip" }, "HEAD");
      assert.equal(head.status, 200);
      assert.equal(head.body.length, 0);
      assert.equal(head.headers.etag, first.headers.etag);
      assert.equal(head.headers["content-length"], first.headers["content-length"]);
      assert.equal(head.headers["content-encoding"], first.headers["content-encoding"]);
      console.log(
        `${filePath}: cold identity ${identity.body.length} bytes, gzip ${first.body.length} bytes, validated repeat ${validated.body.length} bytes`,
      );
    }
  }));

test("keeps config fresh and rejects hosts and paths before cache validation", () =>
  withServer(async ({ config, staticRoot, request }) => {
    assert.equal((await request(scriptPath, { "If-None-Match": "*" }, "POST")).status, 405);
    const initial = await request(RUNTIME_CONFIG_PATH);
    assert.equal(initial.headers["cache-control"], "no-store");
    assert.equal(initial.headers.etag, undefined);
    assert.equal(initial.headers["content-encoding"], undefined);
    config.publish('{"backendUrl":"http://127.0.0.1:2","appToken":"second"}');
    const changed = await request(RUNTIME_CONFIG_PATH, {
      "If-None-Match": "*",
      "Accept-Encoding": "gzip",
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.headers["cache-control"], "no-store");
    assert.equal(changed.headers.etag, undefined);
    assert.equal(JSON.parse(decodedBody(changed).toString()).appToken, "second");
    for (const filePath of ["/", scriptPath, RUNTIME_CONFIG_PATH]) {
      assert.equal(
        (await request(filePath, { Host: "untrusted.example", "If-None-Match": "*" })).status,
        403,
      );
    }
    await writeFile(path.join(staticRoot, "late.js"), "not in startup index");
    for (const filePath of [
      "/missing.js",
      "/late.js",
      "/%2e%2e%2fsecret.txt",
      "/%00",
      "/%E0%A4%A",
    ]) {
      assert.equal(
        (await request(filePath, { "If-None-Match": "*", "Accept-Encoding": "gzip" })).status,
        404,
        filePath,
      );
    }
  }));

test("loads changed hashes after a build and reports broken asset reads", () =>
  withServer(async (fixture) => {
    const { packageRoot, staticRoot, request } = fixture;
    const first = await request(scriptPath);
    const firstHtml = await request("/", { "Accept-Encoding": "gzip" });
    const nextScript = Buffer.from("export const value = 'second build';\n".repeat(100));
    const nextPath = hashedName(nextScript);
    await fixture.server.close();
    await rm(path.join(staticRoot, scriptPath));
    await writeFile(path.join(staticRoot, nextPath), nextScript);
    await writeFile(
      path.join(staticRoot, "index.html"),
      `<html><script src="${nextPath}"></script></html>`,
    );
    fixture.server = await runWebBoundary(
      startStaticFrontendServerEffect(
        { packageRoot, frontendPort: fixture.server.port },
        fixture.config,
      ),
    );
    const nextHtml = await request("/", {
      "If-None-Match": firstHtml.headers.etag ?? "",
      "Accept-Encoding": "gzip",
    });
    assert.equal(nextHtml.status, 200);
    assert.notEqual(nextHtml.headers.etag, firstHtml.headers.etag);
    assert.ok(decodedBody(nextHtml).toString().includes(nextPath));
    const next = await request(nextPath, {
      "If-None-Match": first.headers.etag ?? "",
      "Accept-Encoding": "gzip",
    });
    assert.equal(next.status, 200);
    assert.deepEqual(decodedBody(next), nextScript);
    assert.ok(next.body.length < nextScript.length / 2);
    assert.notEqual(next.headers.etag, first.headers.etag);
    assert.equal((await request(scriptPath)).status, 404);
    await rm(path.join(staticRoot, nextPath));
    assert.equal((await request(nextPath, { "If-None-Match": "*" })).status, 500);
    assert.equal((await request(nextPath, {}, "HEAD")).status, 500);
    await rm(path.join(staticRoot, "index.html"));
    assert.equal((await request("/", { "If-None-Match": "*" })).status, 500);
  }));
