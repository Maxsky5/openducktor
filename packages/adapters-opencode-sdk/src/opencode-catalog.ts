import type { ModelInfo, OpenCodeClient } from "@opencode/client";
import {
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
  OPENCODE_RUNTIME_DESCRIPTOR,
  skillCatalogSchema,
} from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentRuntimeCatalogRead,
  AgentSkillCatalog,
  AgentSlashCommandCatalog,
  AgentSubagentCatalog,
} from "@openducktor/core";

export const readModelCatalog = async (
  client: OpenCodeClient,
  directory: string,
): Promise<AgentModelCatalog> => {
  const models = await client.model.list({ location: { directory } });
  return readModelCatalogFromModels(client, directory, models.data);
};

export const readCatalog = async (
  client: OpenCodeClient,
  directory: string,
): Promise<AgentRuntimeCatalogRead> => {
  // model.list waits for plugin activation; the other catalog list APIs can return empty before it.
  const nativeModels = client.model.list({ location: { directory } });
  const readySurface = <Value>(read: (models: ModelInfo[]) => Promise<Value>) =>
    surface(async () => read((await nativeModels).data));
  const [models, slashCommands, subagents, skills] = await Promise.all([
    readySurface((models) => readModelCatalogFromModels(client, directory, models)),
    readySurface(async () => ({
      commands: [
        ...(await client.command.list({ location: { directory } })).data
          .filter((command) => command.name !== "compact")
          .map((command) => {
            const entry: AgentSlashCommandCatalog["commands"][number] = {
              id: `command:${command.name}`,
              trigger: command.name,
              title: command.name,
              source: "command" as const,
              hints: [],
            };
            if (command.description) entry.description = command.description;
            return entry;
          }),
        MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
      ],
    })),
    readySurface(async () => ({
      subagents: (await client.agent.list({ location: { directory } })).data
        .filter((agent) => !agent.hidden && agent.mode !== "primary")
        .map((agent) => {
          const entry: AgentSubagentCatalog["subagents"][number] = {
            id: agent.id,
            name: agent.id,
          };
          if (agent.description) entry.description = agent.description;
          return entry;
        }),
    })),
    readySurface(async () =>
      skillCatalogSchema.parse({
        skills: (await client.skill.list({ location: { directory } })).data.map((skill) => {
          const entry: AgentSkillCatalog["skills"][number] = {
            id: skill.id,
            name: skill.name,
            path: skill.path,
          };
          if (skill.description) entry.description = skill.description;
          return entry;
        }),
      }),
    ),
  ]);
  return { runtime: OPENCODE_RUNTIME_DESCRIPTOR, models, slashCommands, subagents, skills };
};

const readModelCatalogFromModels = async (
  client: OpenCodeClient,
  directory: string,
  models: ModelInfo[],
): Promise<AgentModelCatalog> => {
  const input = { location: { directory } };
  const [providers, agents, defaultModel] = await Promise.all([
    client.provider.list(input),
    client.agent.list(input),
    client.model.default(input),
  ]);
  return {
    runtime: OPENCODE_RUNTIME_DESCRIPTOR,
    models: models
      .filter((model) => model.enabled)
      .map((model) => {
        const descriptor: AgentModelCatalog["models"][number] = {
          id: `${model.providerID}/${model.id}`,
          providerId: model.providerID,
          providerName:
            providers.data.find((provider) => provider.id === model.providerID)?.name ??
            model.providerID,
          modelId: model.id,
          modelName: model.name,
          // OpenCode accepts "default" even when the model has no named variants.
          variants: [...new Set(["default", ...model.variants.map((variant) => variant.id)])],
          attachmentSupport: {
            image: model.capabilities.input.includes("image"),
            audio: model.capabilities.input.includes("audio"),
            video: model.capabilities.input.includes("video"),
            pdf: model.capabilities.input.includes("pdf"),
          },
        };
        if (model.limit.context > 0) descriptor.contextWindow = model.limit.context;
        if (model.limit.output > 0) descriptor.outputLimit = model.limit.output;
        return descriptor;
      }),
    defaultModelsByProvider: defaultModel.data
      ? { [defaultModel.data.providerID]: defaultModel.data.id }
      : {},
    profiles: agents.data.map((agent) => {
      const profile: NonNullable<AgentModelCatalog["profiles"]>[number] = {
        id: agent.id,
        name: agent.id,
        mode: agent.mode,
      };
      if (agent.description) profile.description = agent.description;
      if (agent.hidden !== undefined) profile.hidden = agent.hidden;
      return profile;
    }),
  };
};

const surface = async <Value>(read: () => Promise<Value>) => {
  try {
    return { status: "available" as const, catalog: await read() };
  } catch (cause) {
    return { status: "failed" as const, cause };
  }
};
