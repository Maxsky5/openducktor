import {
  type GlobalConfig,
  globalConfigSchema,
  type PersistedGlobalConfigV2,
  persistedGlobalConfigV2Schema,
} from "@openducktor/contracts";
import { z, type JSONType } from "zod";
import { HostValidationError } from "../effect/host-errors";

type PersistedConfigObject = Record<string, JSONType>;
const persistedConfigObjectSchema = z.record(z.string(), z.json());
const isPersistedConfigObject = (value: JSONType | undefined): value is PersistedConfigObject =>
  persistedConfigObjectSchema.safeParse(value).success;

export type LoadedGlobalConfig = GlobalConfig;

export const createDefaultGlobalConfig = (): LoadedGlobalConfig =>
  globalConfigSchema.parse({ version: 3 });

const migrateReusablePrompts = (payload: PersistedConfigObject) => {
  const chat = payload.chat;
  const customPrompts = chat && isPersistedConfigObject(chat) ? chat.customPrompts : undefined;
  if (payload.reusablePrompts !== undefined || !Array.isArray(customPrompts)) {
    return payload;
  }

  return {
    ...payload,
    reusablePrompts: customPrompts,
  };
};

const migrateRepositoryGitConfig = (workspaceId: string, workspace: JSONType): JSONType => {
  if (!isPersistedConfigObject(workspace) || !isPersistedConfigObject(workspace.git)) {
    return workspace;
  }

  const { providers, ...git } = workspace.git;
  if (!isPersistedConfigObject(providers)) {
    return workspace;
  }

  const entries = Object.entries(providers);
  if (Object.hasOwn(git, "provider")) {
    throw new HostValidationError({
      message: `Repository "${workspaceId}" contains both canonical and legacy Git provider configuration.`,
    });
  }
  if (entries.length > 1) {
    throw new HostValidationError({
      message: `Repository "${workspaceId}" has ${entries.length} legacy Git providers; only one provider can be configured.`,
    });
  }
  if (entries.length === 0) {
    return { ...workspace, git };
  }

  const [providerId, config] = entries[0]!;
  const provider = isPersistedConfigObject(config) ? { ...config, id: providerId } : config;
  return { ...workspace, git: { ...git, provider } };
};

const migrateRepositoryGitConfigs = (payload: PersistedConfigObject) => {
  if (!isPersistedConfigObject(payload.workspaces)) {
    return payload;
  }
  return {
    ...payload,
    workspaces: Object.fromEntries(
      Object.entries(payload.workspaces).map(([id, workspace]) => [
        id,
        migrateRepositoryGitConfig(id, workspace),
      ]),
    ),
  };
};

const migratePersistedConfig = (payload: PersistedConfigObject) =>
  migrateRepositoryGitConfigs(migrateReusablePrompts(payload));

const parseSupportedConfigObject = (
  payload: JSONType,
  expectedVersion: 2 | 3,
): PersistedConfigObject => {
  if (!isPersistedConfigObject(payload)) {
    throw new HostValidationError({ message: "Config file must contain a JSON object." });
  }

  const version = payload.version;
  if (version !== expectedVersion) {
    throw new HostValidationError({
      message: `Unsupported config version ${String(version)}. Expected ${expectedVersion}.`,
    });
  }
  return payload;
};

const MAX_REPORTED_CONFIG_ISSUES = 5;
const MAX_REPORTED_VALUE_LENGTH = 60;

const jsonRecordSchema = z.record(z.string(), z.json());
const jsonArraySchema = z.array(z.json());
const jsonScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const formatIssuePath = (path: readonly PropertyKey[]): string =>
  path.length === 0 ? "config" : path.map((segment) => String(segment)).join(".");

const readPathValue = (payload: JSONType, path: readonly PropertyKey[]): JSONType | undefined => {
  let current: JSONType | undefined = payload;
  for (const segment of path) {
    const key = String(segment);
    const record = jsonRecordSchema.safeParse(current);
    if (record.success) {
      current = record.data[key];
      continue;
    }

    const array = jsonArraySchema.safeParse(current);
    if (!array.success) {
      return undefined;
    }
    current = array.data[Number(key)];
  }
  return current;
};

const formatReceivedValue = (value: JSONType | undefined): string => {
  if (value === undefined) {
    return " (missing)";
  }

  const scalar = jsonScalarSchema.safeParse(value);
  if (!scalar.success) {
    return "";
  }

  const serialized = JSON.stringify(scalar.data) ?? String(scalar.data);
  const text =
    serialized.length > MAX_REPORTED_VALUE_LENGTH
      ? `${serialized.slice(0, MAX_REPORTED_VALUE_LENGTH)}...`
      : serialized;
  return ` (found ${text})`;
};

const formatConfigIssue = (issue: z.core.$ZodIssue, payload: JSONType): string =>
  `${formatIssuePath(issue.path)}: ${issue.message}${formatReceivedValue(
    readPathValue(payload, issue.path),
  )}`;

const formatConfigIssues = (error: z.ZodError, payload: JSONType): string => {
  const reported = error.issues
    .slice(0, MAX_REPORTED_CONFIG_ISSUES)
    .map((issue) => formatConfigIssue(issue, payload));
  const remaining = error.issues.length - MAX_REPORTED_CONFIG_ISSUES;
  if (remaining > 0) {
    reported.push(`${remaining} more ${remaining === 1 ? "problem" : "problems"} not shown.`);
  }
  return reported.join("\n");
};

const migratePersistedConfigOrThrow = (
  payload: JSONType,
  expectedVersion: 2 | 3,
): PersistedConfigObject => {
  try {
    return migratePersistedConfig(parseSupportedConfigObject(payload, expectedVersion));
  } catch (cause) {
    throw new HostValidationError({
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    });
  }
};

const parsePersistedConfig = <Output>(
  payload: JSONType,
  expectedVersion: 2 | 3,
  schema: z.ZodType<Output>,
): Output => {
  const migrated = migratePersistedConfigOrThrow(payload, expectedVersion);
  const parsed = schema.safeParse(migrated);
  if (parsed.success) {
    return parsed.data;
  }

  throw new HostValidationError({
    message: formatConfigIssues(parsed.error, migrated),
    cause: parsed.error,
  });
};

export const parsePersistedGlobalConfig = (payload: JSONType): LoadedGlobalConfig =>
  parsePersistedConfig(payload, 3, globalConfigSchema);

export const parsePersistedGlobalConfigV2 = (payload: JSONType): PersistedGlobalConfigV2 =>
  parsePersistedConfig(payload, 2, persistedGlobalConfigV2Schema);

export const readPersistedGlobalConfigVersion = (payload: JSONType): 2 | 3 => {
  if (!isPersistedConfigObject(payload)) {
    throw new HostValidationError({ message: "Config file must contain a JSON object." });
  }
  const version = payload.version;
  if (version === 2 || version === 3) {
    return version;
  }
  throw new HostValidationError({
    message: `Unsupported config version ${String(version)}. Expected 2 or 3.`,
  });
};

export const upgradePersistedGlobalConfigV2 = (
  config: PersistedGlobalConfigV2,
  executablePaths: Record<string, string>,
): LoadedGlobalConfig => {
  const agentRuntimes = Object.fromEntries(
    Object.entries(config.agentRuntimes).map(([kind, runtime]) => [
      kind,
      {
        ...runtime,
        executablePath: executablePaths[kind] ?? "",
      },
    ]),
  );

  return globalConfigSchema.parse({
    ...config,
    version: 3,
    agentRuntimes,
  });
};
