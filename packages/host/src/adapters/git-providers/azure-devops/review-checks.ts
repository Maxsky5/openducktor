import type {
  PullRequestReviewAggregateStatus,
  PullRequestReviewCheck,
} from "@openducktor/contracts";
import { optionalRecord, optionalString, requireRecord } from "./models";
import {
  azureDevOpsPositiveIntegerSchema,
  azureDevOpsTimestampSchema,
  type AzureDevOpsJson,
  type AzureDevOpsJsonRecord,
} from "./json";

const statusKey = (genre: string, name: string): string => `${genre}\n${name}`;

/** Returns the latest check for each status genre and name, keyed by `statusKey`. */
export const latestStatusChecks = (
  values: AzureDevOpsJson[],
): Map<string, PullRequestReviewCheck> => {
  const latest = new Map<string, { check: PullRequestReviewCheck; updatedAt: string }>();
  for (const value of values) {
    const record = requireRecord(value, "status");
    const context = requireRecord(record.context, "status.context");
    const genre = optionalString(context.genre) ?? "status";
    const name = optionalString(context.name) ?? optionalString(record.description) ?? "Unnamed";
    const updatedAt =
      optionalString(record.updatedDate) ?? optionalString(record.creationDate) ?? "";
    const key = statusKey(genre, name);
    const prior = latest.get(key);
    if (!prior || prior.updatedAt <= updatedAt) {
      latest.set(key, {
        updatedAt,
        check: statusCheck(record, genre, name),
      });
    }
  }
  return new Map([...latest].map(([key, entry]) => [key, entry.check]));
};

const statusCheck = (
  record: AzureDevOpsJsonRecord,
  genre: string,
  name: string,
): PullRequestReviewCheck => {
  const state = optionalString(record.state)?.toLowerCase() ?? "unknown";
  const status = ["pending", "notset", "not_set"].includes(state)
    ? "in_progress"
    : ["succeeded", "failed", "error", "notapplicable", "not_applicable"].includes(state)
      ? "completed"
      : "unknown";
  const conclusion =
    state === "succeeded"
      ? "success"
      : ["failed", "error"].includes(state)
        ? "failure"
        : ["notapplicable", "not_applicable"].includes(state)
          ? "skipped"
          : state === "unknown"
            ? "unknown"
            : null;
  return {
    name: `${genre}: ${name}`,
    workflow: "Azure DevOps status",
    status,
    conclusion,
    url: optionalString(record.targetUrl),
    details: optionalString(record.description) ?? `Azure state: ${state}`,
    startedAt: timestampOrNull(record.creationDate),
    completedAt: status === "completed" ? timestampOrNull(record.updatedDate) : null,
  };
};

// Azure DevOps policy type IDs. Other policy types, such as reviewer or merge strategy
// policies, are pull request completion rules and not CI checks.
const BUILD_POLICY_TYPE_ID = "0609b952-1397-4640-95ec-e00a01b2c241";
const STATUS_POLICY_TYPE_ID = "cbdc66da-9728-4af8-aada-9a5a32e4a226";

type AzureCiPolicy = {
  check: PullRequestReviewCheck;
  requirement: string;
  /** Build that the policy currently evaluates. Null when no current build exists. */
  buildId: number | null;
  /** Status that the policy waits for. Null for build policies. */
  statusKey: string | null;
};

export const parseCiPolicy = (value: AzureDevOpsJson): AzureCiPolicy[] => {
  const record = requireRecord(value, "policy");
  const configuration = requireRecord(record.configuration, "policy.configuration");
  const type = requireRecord(configuration.type, "policy.configuration.type");
  const settings = optionalRecord(configuration.settings) ?? {};
  const context = optionalRecord(record.context) ?? {};
  const requirement = configuration.isBlocking === false ? "Optional" : "Required";
  if (type.id === BUILD_POLICY_TYPE_ID) {
    const name =
      optionalString(settings.displayName) ??
      optionalString(context.buildDefinitionName) ??
      `Build ${String(settings.buildDefinitionId ?? configuration.id ?? "unknown")}`;
    const isBuildCurrent = context.isExpired !== true && context.buildIsNotCurrent !== true;
    return [
      {
        check: policyEvaluationCheck(
          record,
          name,
          "Azure Pipelines",
          `${requirement} build policy`,
        ),
        requirement,
        buildId: isBuildCurrent ? readBuildId(context.buildId) : null,
        statusKey: null,
      },
    ];
  }
  if (type.id === STATUS_POLICY_TYPE_ID) {
    const genre = optionalString(settings.statusGenre) ?? "status";
    const statusName = optionalString(settings.statusName) ?? "Unnamed";
    const name = optionalString(settings.defaultDisplayName) ?? `${genre}: ${statusName}`;
    return [
      {
        check: policyEvaluationCheck(
          record,
          name,
          "Azure DevOps status",
          `${requirement} status policy`,
        ),
        requirement,
        buildId: null,
        statusKey: statusKey(genre, statusName),
      },
    ];
  }
  return [];
};

/**
 * Builds one check per CI policy. A build policy uses its current build for state and link.
 * A status policy is omitted when the status it waits for is already posted.
 */
export const policyCheck = (
  policy: AzureCiPolicy,
  builds: ReadonlyMap<number, PullRequestReviewCheck>,
  statusChecks: ReadonlyMap<string, PullRequestReviewCheck>,
): PullRequestReviewCheck[] => {
  if (policy.statusKey !== null && statusChecks.has(policy.statusKey)) {
    return [];
  }
  const build = policy.buildId === null ? undefined : builds.get(policy.buildId);
  if (!build) {
    return [policy.check];
  }
  return [
    {
      ...build,
      name: policy.check.name,
      details: `${policy.requirement} build policy; ${build.details}`,
    },
  ];
};

const policyEvaluationCheck = (
  record: AzureDevOpsJsonRecord,
  name: string,
  workflow: string,
  description: string,
): PullRequestReviewCheck => {
  const state = optionalString(record.status)?.toLowerCase() ?? "unknown";
  const status =
    state === "queued"
      ? "queued"
      : state === "running"
        ? "in_progress"
        : ["approved", "rejected", "notapplicable", "broken"].includes(state)
          ? "completed"
          : "unknown";
  const conclusion =
    state === "approved"
      ? "success"
      : state === "rejected"
        ? "failure"
        : state === "notapplicable"
          ? "skipped"
          : state === "broken"
            ? "action_required"
            : state === "unknown"
              ? "unknown"
              : null;
  return {
    name,
    workflow,
    status,
    conclusion,
    url: null,
    details: `${description}; Azure policy state: ${state}`,
    startedAt: timestampOrNull(record.startedDate),
    completedAt: status === "completed" ? timestampOrNull(record.completedDate) : null,
  };
};

const readBuildId = (value: AzureDevOpsJson | undefined): number | null => {
  const numeric = optionalString(value) ? Number(value) : value;
  return azureDevOpsPositiveIntegerSchema.safeParse(numeric).data ?? null;
};

export const parseBuildCheck = (value: AzureDevOpsJson): PullRequestReviewCheck => {
  const record = requireRecord(value, "build");
  const definition = requireRecord(record.definition, "build.definition");
  const statusValue = optionalString(record.status)?.toLowerCase() ?? "unknown";
  const result = optionalString(record.result)?.toLowerCase() ?? null;
  const status = ["notstarted", "postponed"].includes(statusValue)
    ? "queued"
    : ["inprogress", "cancelling"].includes(statusValue)
      ? "in_progress"
      : statusValue === "completed"
        ? "completed"
        : "unknown";
  const conclusion =
    result === "succeeded"
      ? "success"
      : result === "failed"
        ? "failure"
        : result === "canceled"
          ? "cancelled"
          : result === "partiallysucceeded"
            ? "neutral"
            : status === "unknown"
              ? "unknown"
              : null;
  return {
    name: optionalString(definition.name) ?? `Build ${String(record.id ?? "unknown")}`,
    workflow: "Azure Pipelines",
    status,
    conclusion,
    url: buildWebUrl(record),
    details: `Azure build status: ${statusValue}${result ? `; result: ${result}` : ""}`,
    startedAt: timestampOrNull(record.startTime),
    completedAt: timestampOrNull(record.finishTime),
  };
};

export const aggregateChecks = (
  checks: PullRequestReviewCheck[],
): PullRequestReviewAggregateStatus => {
  if (checks.length === 0) {
    return "unknown";
  }
  if (
    checks.some((check) =>
      ["failure", "cancelled", "timed_out", "action_required"].includes(check.conclusion ?? ""),
    )
  ) {
    return "failure";
  }
  if (checks.some((check) => ["queued", "in_progress"].includes(check.status))) {
    return "pending";
  }
  if (checks.some((check) => check.status === "unknown" || check.conclusion === "unknown")) {
    return "unknown";
  }
  const applicable = checks.filter((check) => check.conclusion !== "skipped");
  if (applicable.length > 0 && applicable.every((check) => check.conclusion === "neutral")) {
    return "neutral";
  }
  return applicable.every((check) => check.conclusion === "success") ? "success" : "unknown";
};

const buildWebUrl = (record: AzureDevOpsJsonRecord): string | null => {
  const web = optionalRecord(optionalRecord(record._links)?.web);
  const href = optionalString(web?.href);
  if (href) {
    return href;
  }
  return optionalString(record.url);
};

export const timestampOrNull = (value: AzureDevOpsJson | undefined): string | null =>
  azureDevOpsTimestampSchema.safeParse(value).data ?? null;
