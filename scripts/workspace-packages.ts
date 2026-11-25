/// <reference types="node" />

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

const rootPackageManifestSchema = z.object({
  workspaces: z.array(z.string()),
});

function readRootWorkspacePatterns(workspaceRoot: string): string[] {
  const rootPackageJsonPath = resolve(workspaceRoot, "package.json");
  const parsed = rootPackageManifestSchema.safeParse(
    JSON.parse(readFileSync(rootPackageJsonPath, "utf8")),
  );
  if (!parsed.success) throw new Error("Root package.json must define workspaces as strings.");
  return parsed.data.workspaces;
}

function expandWorkspacePattern(workspaceRoot: string, pattern: string): string[] {
  if (!pattern.endsWith("/*")) {
    const directWorkspacePath = pattern.endsWith("/package.json")
      ? pattern
      : join(pattern, "package.json");
    const directWorkspaceAbsolutePath = resolve(workspaceRoot, directWorkspacePath);
    return existsSync(directWorkspaceAbsolutePath) ? [directWorkspacePath] : [];
  }

  const parentRelativePath = pattern.slice(0, -2);
  const parentAbsolutePath = resolve(workspaceRoot, parentRelativePath);
  const childNames = readdirSync(parentAbsolutePath).sort((left, right) =>
    left.localeCompare(right),
  );

  return childNames.flatMap((childName) => {
    const childRelativePath = join(parentRelativePath, childName);
    const childAbsolutePath = resolve(workspaceRoot, childRelativePath);

    if (!statSync(childAbsolutePath).isDirectory()) {
      return [];
    }

    const packageJsonPath = resolve(childAbsolutePath, "package.json");
    if (!existsSync(packageJsonPath)) {
      return [];
    }

    return [`${childRelativePath}/package.json`];
  });
}

/** The package.json of each workspace of the root package.json. */
export function workspacePackageJsonPaths(workspaceRoot = process.cwd()): string[] {
  return readRootWorkspacePatterns(workspaceRoot).flatMap((pattern) =>
    expandWorkspacePattern(workspaceRoot, pattern),
  );
}
