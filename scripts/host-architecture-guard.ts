import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

const HOST_ROOT = "packages/host/src";
const MAX_PRODUCTION_FILE_LINES = 500;
const MAX_USE_CASE_FILE_LINES = 200;
const ROOT_MODULE_DIRECTORIES = ["application", "adapters"];

type Violation = {
  filePath: string;
  message: string;
};

const isSourceFile = (filePath: string): boolean =>
  filePath.endsWith(".ts") && !filePath.endsWith(".test.ts") && !filePath.endsWith(".spec.ts");

const toPosixPath = (filePath: string): string => filePath.replaceAll("\\", "/");

const relativeHostPath = (filePath: string): string => toPosixPath(relative(HOST_ROOT, filePath));

const isTestSupportFile = (filePath: string): boolean =>
  relativeHostPath(filePath).split("/").includes("test-support");

const walkFiles = (root: string): string[] => {
  if (!existsSync(root)) {
    return [];
  }

  const stack = [root];
  const files: string[] = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    for (const entry of readdirSync(current)) {
      const absolute = join(current, entry);
      const stats = statSync(absolute);
      if (stats.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (isSourceFile(absolute) && !isTestSupportFile(absolute)) {
        files.push(absolute);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
};

const lineCount = (filePath: string): number => {
  const source = readFileSync(filePath, "utf8");
  if (source.length === 0) {
    return 0;
  }

  return source.split("\n").length;
};

const isInnerLayerFile = (filePath: string): boolean => {
  const relativePath = relativeHostPath(filePath);
  return (
    relativePath.startsWith("application/") ||
    relativePath.startsWith("domain/") ||
    relativePath.startsWith("interface/") ||
    relativePath.startsWith("ports/")
  );
};

const isUseCaseFile = (filePath: string): boolean =>
  relativeHostPath(filePath).includes("/use-cases/") ||
  /(?:^|\/)[^/]*use-case[^/]*\.ts$/.test(toPosixPath(filePath));

const containsNodeImport = (source: string): boolean =>
  /(?:^|\n)\s*import(?:\s+type)?[\s\S]*?from\s+["']node:/.test(source);

const hasForbiddenInwardDependency = (source: string): boolean =>
  /(?:^|\n)\s*import(?:\s+type)?[\s\S]*?from\s+["'][^"']*(?:adapters|infrastructure)\//.test(
    source,
  );

const hasForbiddenSupportPackageDependency = (source: string): boolean =>
  /(?:^|\n)\s*import(?:\s+type)?[\s\S]*?from\s+["']@openducktor\/node-support["']/.test(source);

const isDirectRootModuleFile = (filePath: string): boolean => {
  const segments = relativeHostPath(filePath).split("/");
  return ROOT_MODULE_DIRECTORIES.includes(segments[0] ?? "") && segments.length === 2;
};

const hasMigrationServiceName = (filePath: string): boolean =>
  /(?:^|\/)task-service-[^/]+\.ts$/.test(toPosixPath(filePath));

const isLegacyCommandRootFile = (filePath: string): boolean =>
  relativeHostPath(filePath).startsWith("commands/");

const isAdapterFile = (filePath: string): boolean =>
  relativeHostPath(filePath).startsWith("adapters/");

const hasPlatformOrStorageAdapterFileName = (filePath: string): boolean =>
  /^(?:node|in-memory)-/.test(basename(toPosixPath(filePath)));

const findViolations = (): Violation[] => {
  const violations: Violation[] = [];

  for (const filePath of walkFiles(HOST_ROOT)) {
    const source = readFileSync(filePath, "utf8");
    const lines = lineCount(filePath);

    if (lines > MAX_PRODUCTION_FILE_LINES) {
      violations.push({
        filePath,
        message: `production host files must stay <= ${MAX_PRODUCTION_FILE_LINES} lines (${lines})`,
      });
    }

    if (isUseCaseFile(filePath) && lines > MAX_USE_CASE_FILE_LINES) {
      violations.push({
        filePath,
        message: `host use-case files must stay <= ${MAX_USE_CASE_FILE_LINES} lines (${lines})`,
      });
    }

    if (isInnerLayerFile(filePath) && containsNodeImport(source)) {
      violations.push({
        filePath,
        message: "host inner-layer files must not import Node APIs",
      });
    }

    if (isInnerLayerFile(filePath) && hasForbiddenInwardDependency(source)) {
      violations.push({
        filePath,
        message: "host inner-layer files must not import adapters or infrastructure",
      });
    }

    if (isInnerLayerFile(filePath) && hasForbiddenSupportPackageDependency(source)) {
      violations.push({
        filePath,
        message: "host inner-layer files must not import Node-only support packages",
      });
    }

    if (isDirectRootModuleFile(filePath)) {
      violations.push({
        filePath,
        message: "host application and adapter files must live in named submodules",
      });
    }

    if (hasMigrationServiceName(filePath)) {
      violations.push({
        filePath,
        message: "host task files must use domain/action names, not task-service-* migration names",
      });
    }

    if (isLegacyCommandRootFile(filePath)) {
      violations.push({
        filePath,
        message: "host commands belong under src/interface/commands, not src/commands",
      });
    }

    if (isAdapterFile(filePath) && hasPlatformOrStorageAdapterFileName(filePath)) {
      violations.push({
        filePath,
        message:
          "host adapter filenames must describe the external boundary, not start with node-* or in-memory-*",
      });
    }
  }

  return violations;
};

const violations = findViolations();

if (violations.length > 0) {
  console.error(
    `[host-architecture-guard] Found ${violations.length} host architecture violation(s).`,
  );
  for (const violation of violations) {
    console.error(`[host-architecture-guard] ${violation.filePath}: ${violation.message}`);
  }
  process.exit(1);
}

console.log("[host-architecture-guard] Host architecture boundaries are clean.");
