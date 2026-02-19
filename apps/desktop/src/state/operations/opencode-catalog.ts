import { errorMessage } from "@/lib/errors";
import type { RepoOpencodeHealthCheck } from "@/types/diagnostics";
import { OpencodeSdkAdapter } from "@openblueprint/adapters-opencode-sdk";
import type { AgentRuntimeSummary } from "@openblueprint/contracts";
import type { AgentModelCatalog } from "@openblueprint/core";
import { host } from "./host";

type ListCatalogInput = {
  baseUrl: string;
  workingDirectory: string;
};

type OpencodeCatalogDependencies = {
  ensureRuntime: (repoPath: string) => Promise<AgentRuntimeSummary>;
  listAvailableModels: (input: ListCatalogInput) => Promise<AgentModelCatalog>;
  listAvailableToolIds: (input: ListCatalogInput) => Promise<string[]>;
};

const toBaseUrl = (port: number): string => `http://127.0.0.1:${port}`;
const toNowIso = (): string => new Date().toISOString();

export const REQUIRED_ODT_TOOL_IDS = [
  "odt_read_task",
  "odt_set_spec",
  "odt_set_plan",
  "odt_build_blocked",
  "odt_build_resumed",
  "odt_build_completed",
  "odt_qa_approved",
  "odt_qa_rejected",
] as const;

export const createOpencodeCatalogOperations = (deps: OpencodeCatalogDependencies) => {
  const loadRepoOpencodeCatalog = async (repoPath: string): Promise<AgentModelCatalog> => {
    const runtime = await deps.ensureRuntime(repoPath);
    return deps.listAvailableModels({
      baseUrl: toBaseUrl(runtime.port),
      workingDirectory: runtime.workingDirectory,
    });
  };

  const checkRepoOpencodeHealth = async (repoPath: string): Promise<RepoOpencodeHealthCheck> => {
    const checkedAt = toNowIso();
    let runtime: AgentRuntimeSummary | null = null;

    try {
      runtime = await deps.ensureRuntime(repoPath);
    } catch (error) {
      const runtimeError = errorMessage(error);
      return {
        runtimeOk: false,
        runtimeError,
        runtime: null,
        mcpOk: false,
        mcpError: "OpenCode runtime is unavailable, so MCP cannot be verified.",
        availableToolIds: [],
        missingRequiredToolIds: [...REQUIRED_ODT_TOOL_IDS],
        checkedAt,
        errors: [runtimeError, "OpenCode runtime is unavailable, so MCP cannot be verified."],
      };
    }

    try {
      const availableToolIds = await deps.listAvailableToolIds({
        baseUrl: toBaseUrl(runtime.port),
        workingDirectory: runtime.workingDirectory,
      });
      const availableToolSet = new Set(availableToolIds);
      const missingRequiredToolIds = REQUIRED_ODT_TOOL_IDS.filter(
        (tool) => !availableToolSet.has(tool),
      );
      const mcpError =
        missingRequiredToolIds.length > 0
          ? `Missing required OpenDucktor MCP tools: ${missingRequiredToolIds.join(", ")}`
          : null;
      const mcpOk = mcpError === null;

      return {
        runtimeOk: true,
        runtimeError: null,
        runtime,
        mcpOk,
        mcpError,
        availableToolIds,
        missingRequiredToolIds,
        checkedAt,
        errors: mcpError ? [mcpError] : [],
      };
    } catch (error) {
      const mcpError = `Failed to query OpenCode tools: ${errorMessage(error)}`;
      return {
        runtimeOk: true,
        runtimeError: null,
        runtime,
        mcpOk: false,
        mcpError,
        availableToolIds: [],
        missingRequiredToolIds: [...REQUIRED_ODT_TOOL_IDS],
        checkedAt,
        errors: [mcpError],
      };
    }
  };

  return {
    loadRepoOpencodeCatalog,
    checkRepoOpencodeHealth,
  };
};

const adapter = new OpencodeSdkAdapter();

const opencodeCatalogOperations = createOpencodeCatalogOperations({
  ensureRuntime: (repoPath) => host.opencodeRepoRuntimeEnsure(repoPath),
  listAvailableModels: (input) => adapter.listAvailableModels(input),
  listAvailableToolIds: (input) => adapter.listAvailableToolIds(input),
});

export const loadRepoOpencodeCatalog = opencodeCatalogOperations.loadRepoOpencodeCatalog;
export const checkRepoOpencodeHealth = opencodeCatalogOperations.checkRepoOpencodeHealth;
