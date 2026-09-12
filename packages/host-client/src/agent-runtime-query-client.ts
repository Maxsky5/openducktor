import { AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS } from "@openducktor/contracts";
import type {
  ListAgentModelsInput,
  ListAgentSkillsInput,
  ListAgentSlashCommandsInput,
  ListAgentSubagentsInput,
  LoadAgentFileStatusInput,
  LoadAgentSessionDiffInput,
  LoadAgentSessionHistoryInput,
  LoadAgentSessionTodosInput,
  SearchAgentFilesInput,
} from "@openducktor/core";
import type { InvokeFn } from "./invoke-utils";

export class HostAgentRuntimeQueryClient {
  constructor(private readonly invokeFn: InvokeFn) {}

  agentRuntimeListModels(input: ListAgentModelsInput) {
    const contract = AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.listModels;
    return this.invokeFn(
      contract.command,
      { input: contract.inputSchema.parse(input) },
      contract.responseSchema,
    );
  }

  agentRuntimeListSlashCommands(input: ListAgentSlashCommandsInput) {
    const contract = AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.listSlashCommands;
    return this.invokeFn(
      contract.command,
      { input: contract.inputSchema.parse(input) },
      contract.responseSchema,
    );
  }

  agentRuntimeListSkills(input: ListAgentSkillsInput) {
    const contract = AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.listSkills;
    return this.invokeFn(
      contract.command,
      { input: contract.inputSchema.parse(input) },
      contract.responseSchema,
    );
  }

  agentRuntimeListSubagents(input: ListAgentSubagentsInput) {
    const contract = AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.listSubagents;
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
