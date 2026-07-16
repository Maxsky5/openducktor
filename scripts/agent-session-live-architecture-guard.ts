import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SHARED_LIVE_PATHS = [
  "packages/host/src/application/agent-sessions",
  "packages/host/src/ports/agent-session-live-adapter-port.ts",
  "packages/host/src/interface/commands/agent-session-live-command-handlers.ts",
  "packages/frontend/src/state/operations/agent-orchestrator/session-read-model/agent-session-live-projection.ts",
  "packages/frontend/src/state/operations/agent-orchestrator/hooks/use-repo-session-read-model.ts",
  "packages/frontend/src/state/operations/agent-orchestrator/events/session-transcript-events.ts",
  "packages/frontend/src/state/operations/agent-orchestrator/handlers/pending-input-actions.ts",
  "packages/frontend/src/state/operations/agent-orchestrator/history/use-selected-session-context-load.ts",
  "packages/frontend/src/state/operations/agent-orchestrator/support/orchestrator-ports.ts",
];

const RUNTIME_NEUTRAL_CONTROL_CONTRACT_PATHS = [
  "packages/contracts/src/agent-session-control-schemas.ts",
  "packages/frontend/src/state/agent-runtime-services.ts",
  "packages/frontend/src/state/operations/agent-orchestrator/handlers/start-session-fresh-strategy.ts",
  "packages/frontend/src/state/operations/agent-orchestrator/handlers/prepare-session-send.ts",
  "packages/frontend/src/state/operations/agent-orchestrator/handlers/send-agent-message.ts",
];
const FORBIDDEN_SHARED_CONTROL_POLICY_TOKENS = [
  "CodexEffectivePolicy",
  "codexEffectivePolicySchema",
  "assertAgentRuntimePolicyBinding",
  "toAgentRuntimePolicyBinding",
  "resolveAgentSessionRuntimePolicy",
  "resolveRuntimeSessionContextRef",
  "runtimePolicy",
];

const PRODUCTION_SOURCE_ROOTS = ["apps/electron/src", "packages"];
const FORBIDDEN_RAW_CODEX_TOKENS = [
  "openducktor://codex-app-server-event",
  "codex_app_server_respond",
  "codex_app_server_take_buffered_events",
  "codex-app-server-events",
  "takeCodexAppServerBufferedEvents",
  "takeBufferedEvents",
  "subscribeCodexAppServerEvents",
  "respondCodexAppServerRequest",
  "CodexRuntimeEventBuffer",
  "eventBacklogBySessionKey",
];

type Violation = {
  filePath: string;
  message: string;
};

const isProductionSourceFile = (filePath: string): boolean =>
  (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) &&
  !filePath.endsWith(".test.ts") &&
  !filePath.endsWith(".test.tsx") &&
  !filePath.endsWith(".spec.ts") &&
  !filePath.endsWith(".spec.tsx") &&
  !filePath.includes("/test-support/") &&
  !filePath.includes(".test-");

const collectSourceFiles = (path: string): string[] => {
  if (!existsSync(path)) {
    return [];
  }
  if (!statSync(path).isDirectory()) {
    return isProductionSourceFile(path) ? [path] : [];
  }

  const files: string[] = [];
  const stack = [path];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    for (const entry of readdirSync(current)) {
      if (entry === "node_modules" || entry === "dist" || entry === "build") {
        continue;
      }
      const child = join(current, entry);
      if (statSync(child).isDirectory()) {
        stack.push(child);
      } else if (isProductionSourceFile(child)) {
        files.push(child);
      }
    }
  }
  return files;
};

const violations: Violation[] = [];

for (const filePath of SHARED_LIVE_PATHS.flatMap(collectSourceFiles)) {
  const source = readFileSync(filePath, "utf8");
  if (/\b(?:codex|opencode)\b/i.test(source)) {
    violations.push({
      filePath,
      message: "shared live-session modules must not select or name a runtime implementation",
    });
  }
  if (/@openducktor\/adapters-/.test(source)) {
    violations.push({
      filePath,
      message: "shared live-session modules must not import runtime adapter packages",
    });
  }
}

for (const filePath of RUNTIME_NEUTRAL_CONTROL_CONTRACT_PATHS.flatMap(collectSourceFiles)) {
  const source = readFileSync(filePath, "utf8");
  for (const token of FORBIDDEN_SHARED_CONTROL_POLICY_TOKENS) {
    if (source.includes(token)) {
      violations.push({
        filePath,
        message: `shared session-control boundary must not expose runtime policy token '${token}'`,
      });
    }
  }
}

for (const filePath of PRODUCTION_SOURCE_ROOTS.flatMap(collectSourceFiles)) {
  const source = readFileSync(filePath, "utf8");
  for (const token of FORBIDDEN_RAW_CODEX_TOKENS) {
    if (source.includes(token)) {
      violations.push({
        filePath,
        message: `obsolete raw Codex live-state token '${token}' must not remain`,
      });
    }
  }
}

if (violations.length > 0) {
  console.error(`[agent-session-live-architecture-guard] Found ${violations.length} violation(s).`);
  for (const violation of violations) {
    console.error(
      `[agent-session-live-architecture-guard] ${violation.filePath}: ${violation.message}`,
    );
  }
  process.exit(1);
}

console.log("[agent-session-live-architecture-guard] Live-session boundaries are clean.");
