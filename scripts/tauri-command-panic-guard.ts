import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const COMMANDS_ROOT = "apps/desktop/src-tauri/src/commands";
const BANNED_PATTERN = /\.(expect|unwrap)\s*\(|panic\s*!\s*\(/g;

type Violation = {
  filePath: string;
  line: number;
  snippet: string;
};

const walkRustFiles = (root: string): string[] => {
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
      if (absolute.endsWith(".rs")) {
        files.push(absolute);
      }
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
};

const runtimeSource = (source: string): string => {
  const cfgTestIndex = source.indexOf("#[cfg(test)]");
  if (cfgTestIndex === -1) {
    return source;
  }
  return source.slice(0, cfgTestIndex);
};

const findViolations = (filePath: string): Violation[] => {
  const source = readFileSync(filePath, "utf8");
  const runtime = runtimeSource(source);
  const violations: Violation[] = [];

  BANNED_PATTERN.lastIndex = 0;
  let match = BANNED_PATTERN.exec(runtime);
  while (match) {
    const index = match.index;
    const line = runtime.slice(0, index).split("\n").length;
    const snippet = runtime.split("\n")[line - 1]?.trim() ?? "";
    violations.push({ filePath, line, snippet });
    match = BANNED_PATTERN.exec(runtime);
  }

  return violations;
};

const allViolations = walkRustFiles(COMMANDS_ROOT).flatMap((filePath) => findViolations(filePath));

if (allViolations.length > 0) {
  console.error(
    `[tauri:commands:panic-guard] Found ${allViolations.length} panic-prone runtime usage(s) in Tauri command files.`,
  );
  for (const violation of allViolations) {
    console.error(
      `[tauri:commands:panic-guard] ${violation.filePath}:${violation.line} ${violation.snippet}`,
    );
  }
  console.error(
    "[tauri:commands:panic-guard] Replace with Result-based error handling (e.g., ok_or_else/context/bail).",
  );
  process.exit(1);
}

console.log(
  "[tauri:commands:panic-guard] No runtime .expect/.unwrap/panic! found in Tauri command files.",
);
