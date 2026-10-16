import type {
  PullRequestReviewAggregateStatus,
  PullRequestReviewCheck,
} from "@openducktor/contracts";
import {
  optionalRecord,
  optionalString,
  requireRecord,
  requireString,
  timestampOrNull,
} from "./models";
import {
  azureDevOpsPositiveIntegerSchema,
  type AzureDevOpsJson,
  type AzureDevOpsJsonRecord,
} from "./json";

const BUILD_POLICY_TYPE_ID = "0609b952-1397-4640-95ec-e00a01b2c241";
const STATUS_POLICY_TYPE_ID = "cbdc66da-9728-4af8-aada-9a5a32e4a226";

type AzureCiPolicy =
  | { kind: "build"; check: PullRequestReviewCheck; currentBuildId: number | null }
  | { kind: "status"; check: PullRequestReviewCheck; statusKey: string };

type AzureCiPolicies = { policies: AzureCiPolicy[]; currentBuildIds: number[] };

type AzureReviewChecks = {
  checks: PullRequestReviewCheck[];
  aggregateStatus: PullRequestReviewAggregateStatus;
};

export const parseCiPolicies = (values: AzureDevOpsJson[]): AzureCiPolicies => {
  const policies = values.flatMap(parseCiPolicy);
  const currentBuildIds = new Set(
    policies.flatMap((policy) =>
      policy.kind === "build" && policy.currentBuildId !== null ? [policy.currentBuildId] : [],
    ),
  );
  return { policies, currentBuildIds: [...currentBuildIds] };
};

/**
 * The policy evaluation decides each policy check's state. Its current build or posted status
 * adds the link, times, and details. Posted statuses that no policy claims become their own checks.
 */
export const reviewChecks = ({
  policies,
  builds,
  statuses,
}: {
  policies: AzureCiPolicy[];
  builds: ReadonlyMap<number, AzureDevOpsJson>;
  statuses: AzureDevOpsJson[];
}): AzureReviewChecks => {
  const statusChecks = latestStatusChecks(statuses);
  const claimedStatusKeys = new Set(
    policies.flatMap((policy) => (policy.kind === "status" ? [policy.statusKey] : [])),
  );
  const policyChecks = policies.map((policy) => {
    if (policy.kind === "status") {
      return withSource(policy.check, statusChecks.get(policy.statusKey));
    }
    const build = policy.currentBuildId === null ? undefined : builds.get(policy.currentBuildId);
    return withSource(policy.check, build === undefined ? undefined : parseBuildCheck(build));
  });
  const unclaimedStatusChecks = [...statusChecks]
    .filter(([key]) => !claimedStatusKeys.has(key))
    .map(([, check]) => check);
  const checks = [...policyChecks, ...unclaimedStatusChecks];
  return { checks, aggregateStatus: aggregateChecks(checks) };
};

const withSource = (
  check: PullRequestReviewCheck,
  source: PullRequestReviewCheck | undefined,
): PullRequestReviewCheck =>
  source === undefined
    ? check
    : {
        ...check,
        url: source.url,
        details: `${check.details}; ${source.details}`,
        startedAt: source.startedAt,
        completedAt: check.status === "completed" ? source.completedAt : null,
      };

const parseCiPolicy = (value: AzureDevOpsJson): AzureCiPolicy[] => {
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
        kind: "build",
        check: policyEvaluationCheck(
          record,
          name,
          "Azure Pipelines",
          `${requirement} build policy`,
        ),
        currentBuildId: isBuildCurrent ? readBuildId(context.buildId) : null,
      },
    ];
  }
  if (type.id === STATUS_POLICY_TYPE_ID) {
    const genre = optionalString(settings.statusGenre) ?? "status";
    const statusName = requireString(
      settings.statusName,
      "policy.configuration.settings.statusName",
    );
    const name = optionalString(settings.defaultDisplayName) ?? `${genre}: ${statusName}`;
    return [
      {
        kind: "status",
        check: policyEvaluationCheck(
          record,
          name,
          "Azure DevOps status",
          `${requirement} status policy`,
        ),
        statusKey: statusKey(genre, statusName),
      },
    ];
  }
  return [];
};

const statusKey = (genre: string, name: string): string => `${genre}\n${name}`;

const latestStatusChecks = (values: AzureDevOpsJson[]): Map<string, PullRequestReviewCheck> => {
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

type CheckState = Pick<PullRequestReviewCheck, "status" | "conclusion">;

const statusCheck = (
  record: AzureDevOpsJsonRecord,
  genre: string,
  name: string,
): PullRequestReviewCheck => {
  const state = optionalString(record.state)?.toLowerCase() ?? "unknown";
  const { status, conclusion } = statusState(state);
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

const statusState = (state: string): CheckState => {
  switch (state) {
    case "pending":
    case "notset":
    case "not_set":
      return { status: "in_progress", conclusion: null };
    case "succeeded":
      return { status: "completed", conclusion: "success" };
    case "failed":
    case "error":
      return { status: "completed", conclusion: "failure" };
    case "notapplicable":
    case "not_applicable":
      return { status: "completed", conclusion: "skipped" };
    case "unknown":
      return { status: "unknown", conclusion: "unknown" };
    default:
      return { status: "unknown", conclusion: null };
  }
};

const policyEvaluationCheck = (
  record: AzureDevOpsJsonRecord,
  name: string,
  workflow: string,
  description: string,
): PullRequestReviewCheck => {
  const state = optionalString(record.status)?.toLowerCase() ?? "unknown";
  const { status, conclusion } = policyEvaluationState(state);
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

const policyEvaluationState = (state: string): CheckState => {
  switch (state) {
    case "queued":
      return { status: "queued", conclusion: null };
    case "running":
      return { status: "in_progress", conclusion: null };
    case "approved":
      return { status: "completed", conclusion: "success" };
    case "rejected":
      return { status: "completed", conclusion: "failure" };
    case "notapplicable":
      return { status: "completed", conclusion: "skipped" };
    case "broken":
      return { status: "completed", conclusion: "action_required" };
    case "unknown":
      return { status: "unknown", conclusion: "unknown" };
    default:
      return { status: "unknown", conclusion: null };
  }
};

const readBuildId = (value: AzureDevOpsJson | undefined): number | null => {
  const numeric = optionalString(value) ? Number(value) : value;
  return azureDevOpsPositiveIntegerSchema.safeParse(numeric).data ?? null;
};

const parseBuildCheck = (value: AzureDevOpsJson): PullRequestReviewCheck => {
  const record = requireRecord(value, "build");
  const definition = requireRecord(record.definition, "build.definition");
  const statusValue = optionalString(record.status)?.toLowerCase() ?? "unknown";
  const result = optionalString(record.result)?.toLowerCase() ?? null;
  const status = buildStatus(statusValue);
  const conclusion = buildConclusion(result, status);
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

const buildStatus = (statusValue: string): PullRequestReviewCheck["status"] => {
  switch (statusValue) {
    case "notstarted":
    case "postponed":
      return "queued";
    case "inprogress":
    case "cancelling":
      return "in_progress";
    case "completed":
      return "completed";
    default:
      return "unknown";
  }
};

const buildConclusion = (
  result: string | null,
  status: PullRequestReviewCheck["status"],
): PullRequestReviewCheck["conclusion"] => {
  switch (result) {
    case "succeeded":
      return "success";
    case "failed":
      return "failure";
    case "canceled":
      return "cancelled";
    case "partiallysucceeded":
      return "neutral";
    default:
      return status === "unknown" ? "unknown" : null;
  }
};

const aggregateChecks = (checks: PullRequestReviewCheck[]): PullRequestReviewAggregateStatus => {
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
