import { AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS } from "@openducktor/contracts";
import type {
  ListAgentRuntimeCatalogInput,
  LoadAgentFileStatusInput,
  LoadAgentSessionDiffInput,
  LoadAgentSessionHistoryInput,
  LoadAgentSessionTodosInput,
  SearchAgentFilesInput,
} from "@openducktor/core";
import type { InvokeFn } from "./invoke-utils";

export class HostAgentRuntimeQueryClient {
  constructor(private readonly invokeFn: InvokeFn) {}

  agentRuntimeLoadCatalog(input: ListAgentRuntimeCatalogInput) {
    const contract = AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.loadCatalog;
    return this.invokeFn(
      contract.command,
      { input: contract.inputSchema.parse(input) },
      contract.responseSchema,
    );
  }

  agentRuntimeSearchFiles(input: SearchAgentFilesInput) {
    const contract = AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.searchFiles;
    return this.invokeFn(
      contract.command,
      { input: contract.inputSchema.parse(input) },
      contract.responseSchema,
    );
  }

  agentRuntimeLoadSessionHistory(input: LoadAgentSessionHistoryInput) {
    const contract = AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.loadSessionHistory;
    return this.invokeFn(
      contract.command,
      { input: contract.inputSchema.parse(input) },
      contract.responseSchema,
    );
  }

  agentRuntimeLoadSessionTodos(input: LoadAgentSessionTodosInput) {
    const contract = AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.loadSessionTodos;
    return this.invokeFn(
      contract.command,
      { input: contract.inputSchema.parse(input) },
      contract.responseSchema,
    );
  }

  agentRuntimeLoadSessionDiff(input: LoadAgentSessionDiffInput) {
    const contract = AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.loadSessionDiff;
    return this.invokeFn(
      contract.command,
      { input: contract.inputSchema.parse(input) },
      contract.responseSchema,
    );
  }

  agentRuntimeFileStatus(input: LoadAgentFileStatusInput) {
    const contract = AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.fileStatus;
    return this.invokeFn(
      contract.command,
      { input: contract.inputSchema.parse(input) },
      contract.responseSchema,
    );
  }
}
