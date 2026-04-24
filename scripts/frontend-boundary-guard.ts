import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const FRONTEND_ROOT = "packages/frontend/src";
const DESKTOP_SHELL_ROOT = "apps/desktop/src";

const ALLOWED_DESKTOP_SHELL_FILES = new Set([
  "desktop-shell-bridge.ts",
  "main.tsx",
]);

const SHARED_FRONTEND_BANNED_PATTERNS = [
  {
    pattern: /(?:^|\n)\s*(?:import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?|export\s+(?:type\s+)?[\s\S]*?\s+from\s+|await\s+import\(|import\()\s*["'][^"']*@tauri-apps\/api/,
    message: "Shared frontend code must use the shell bridge instead of importing Tauri APIs directly.",
  },
  {
    pattern: /(?:^|\n)\s*(?:import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?|export\s+(?:type\s+)?[\s\S]*?\s+from\s+|await\s+import\(|import\()\s*["'][^"']*(?:apps\/desktop|src-tauri)/,
    message: "Shared frontend code must not import desktop-shell or Rust host internals.",
  },
];

type Violation = {
  filePath: string;
  line: number;
  message: string;
  snippet: string;
};

const isSourceFile = (filePath: string): boolean => {
  return /\.(ts|tsx|css)$/.test(filePath);
};

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
      if (isSourceFile(absolute)) {
        files.push(absolute);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
};

const lineForIndex = (source: string, index: number): number => source.slice(0, index).split("\n").length;

const findSharedFrontendViolations = (): Violation[] => {
  const violations: Violation[] = [];

  for (const filePath of walkFiles(FRONTEND_ROOT)) {
    const source = readFileSync(filePath, "utf8");
    for (const banned of SHARED_FRONTEND_BANNED_PATTERNS) {
      const match = banned.pattern.exec(source);
      if (!match) {
        continue;
      }
      const line = lineForIndex(source, match.index);
      violations.push({
        filePath,
        line,
        message: banned.message,
        snippet: source.split("\n")[line - 1]?.trim() ?? "",
      });
    }
  }

  return violations;
};

const findDesktopShellViolations = (): Violation[] => {
  return walkFiles(DESKTOP_SHELL_ROOT)
    .filter((filePath) => !ALLOWED_DESKTOP_SHELL_FILES.has(relative(DESKTOP_SHELL_ROOT, filePath)))
    .map((filePath) => ({
      filePath,
      line: 1,
      message:
        "Desktop app source must stay a thin shell. Move shared UI/runtime code to packages/frontend/src.",
      snippet: relative(DESKTOP_SHELL_ROOT, filePath),
    }));
};

const violations = [...findSharedFrontendViolations(), ...findDesktopShellViolations()];

if (violations.length > 0) {
  console.error(`[frontend-boundary-guard] Found ${violations.length} frontend boundary violation(s).`);
  for (const violation of violations) {
    console.error(
      `[frontend-boundary-guard] ${violation.filePath}:${violation.line} ${violation.message} ${violation.snippet}`,
    );
  }
  process.exit(1);
}

console.log("[frontend-boundary-guard] Shared frontend and desktop shell boundaries are clean.");
