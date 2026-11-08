import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * The assets-only Workers that the Docs website workflow deploys. A Worker script,
 * `run_worker_first`, or a binding would run code on requests, so the strict schema refuses
 * any other field.
 */
const workerSchema = z.strictObject({
  $schema: z.string(),
  name: z.string(),
  compatibility_date: z.string(),
  workers_dev: z.boolean(),
  preview_urls: z.boolean(),
  assets: z.strictObject({
    directory: z.string(),
    html_handling: z.string(),
    not_found_handling: z.string(),
  }),
});

function config(name: string): z.infer<typeof workerSchema> {
  return workerSchema.parse(
    JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), "utf8")),
  );
}

describe.each([
  ["wrangler.json", "openducktor-docs", false],
  ["wrangler.preview.json", "openducktor-docs-preview", true],
])("%s", (file, name, previews) => {
  test("serves only the static export, with folder pages and a real 404 page", () => {
    expect(config(file).assets).toEqual({
      directory: "./out",
      html_handling: "auto-trailing-slash",
      not_found_handling: "404-page",
    });
  });

  test("names each Worker, with its own address policy", () => {
    const worker = config(file);
    expect(worker.name).toBe(name);
    expect(worker.workers_dev).toBe(false);
    expect(worker.preview_urls).toBe(previews);
  });
});

test("both Workers run on the same compatibility date", () => {
  expect(config("wrangler.preview.json").compatibility_date).toBe(
    config("wrangler.json").compatibility_date,
  );
});
