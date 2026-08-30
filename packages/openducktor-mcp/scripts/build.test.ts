import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMcpPackage, MCP_PACKAGE_BUILD_ARTIFACTS } from "./build";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");
const distDirectory = join(packageRoot, "dist");

const expectedBuildArtifacts = [...MCP_PACKAGE_BUILD_ARTIFACTS].sort();

describe("MCP package build", () => {
  test("emits the published JavaScript and declaration artifacts after every clean build", async () => {
    await buildMcpPackage();
    expect((await readdir(distDirectory)).sort()).toEqual(expectedBuildArtifacts);

    await buildMcpPackage();
    expect((await readdir(distDirectory)).sort()).toEqual(expectedBuildArtifacts);
  }, 15_000);
});
