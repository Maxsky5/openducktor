import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * The Workers configurations that the Marketing website workflow deploys. Cloudflare serves static asset requests
 * for free and without limit, but a Worker script, `run_worker_first`, or a binding runs code on
 * requests, and the free plan limits those. So the strict schema refuses any other field.
 */
const workerSchema = z.strictObject({
  $schema: z.string(),
  name: z.string(),
  compatibility_date: z.string(),
  workers_dev: z.boolean(),
  preview_urls: z.boolean(),
  assets: z.strictObject({ directory: z.string(), not_found_handling: z.string() }),
});

function config(name: string): z.infer<typeof workerSchema> {
  return workerSchema.parse(
    JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), "utf8")),
  );
}

describe.each([
  ["wrangler.json", "openducktor-marketing", false],
  ["wrangler.preview.json", "openducktor-marketing-preview", true],
])("%s", (file, name, previews) => {
  test("deploys only the static files of dist/, with the 404 page for unknown paths", () => {
    expect(config(file).assets).toEqual({ directory: "./dist", not_found_handling: "404-page" });
  });

  test("names each Worker, with its own address policy", () => {
    const worker = config(file);
    expect(worker.name).toBe(name);
    // Production answers only on its custom domain. The preview Worker serves only the preview
    // URL of each pull request, not a workers.dev address of its own.
    expect(worker.workers_dev).toBe(false);
    expect(worker.preview_urls).toBe(previews);
  });
});

test("both Workers run on the same compatibility date", () => {
  expect(config("wrangler.preview.json").compatibility_date).toBe(
    config("wrangler.json").compatibility_date,
  );
});

test("the schema refuses a Worker script, run_worker_first, or a binding", () => {
  const worker = JSON.parse(readFileSync(new URL("../wrangler.json", import.meta.url), "utf8"));
  expect(() => workerSchema.parse({ ...worker, main: "src/worker.ts" })).toThrow();
  expect(() => workerSchema.parse({ ...worker, kv_namespaces: [] })).toThrow();
  expect(() =>
    workerSchema.parse({ ...worker, assets: { ...worker.assets, run_worker_first: true } }),
  ).toThrow();
});
