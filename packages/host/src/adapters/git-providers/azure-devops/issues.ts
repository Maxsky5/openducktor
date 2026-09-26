import type { AzureDevOpsRepository, RepoConfig, SourceIssue } from "@openducktor/contracts";
import { azureDevOpsCollectionUrl } from "@openducktor/core";
import { Effect } from "effect";
import { z } from "zod";
import { HostOperationError, HostValidationError } from "../../../effect/host-errors";
import type { AzureAreaPathsPort } from "../../../ports/azure-area-paths-port";
import type { GitProviderRepositoryPort, IssueReaderPort } from "../../../ports/git-provider-port";
import type { AzureDevOpsRestClient } from "./rest-client";
import type { AzureDevOpsJson } from "./json";

type AreaNode = {
  name: string;
  hasChildren?: boolean | undefined;
  children?: AreaNode[] | undefined;
};
const areaNodeSchema: z.ZodType<AreaNode> = z.lazy(() =>
  z.object({
    name: z.string().min(1),
    hasChildren: z.boolean().optional(),
    children: z.array(areaNodeSchema).optional(),
  }),
);
const workItemTypesSchema = z.object({
  value: z.array(
    z.object({
      name: z.string().min(1),
      isDisabled: z.boolean().optional(),
    }),
  ),
});
const workItemTypeStatesSchema = z.object({
  value: z.array(z.object({ name: z.string().min(1), category: z.string().min(1) })),
});
const wiqlResultSchema = z.object({
  asOf: z.string().datetime({ offset: true }),
  workItems: z.array(z.object({ id: z.number().int().positive() })),
});
const workItemSchema = z.object({
  id: z.number().int().positive(),
  rev: z.number().int().positive(),
  fields: z.object({
    "System.Title": z.string().min(1),
    "System.WorkItemType": z.string().min(1),
    "System.State": z.string().min(1),
    "System.AreaPath": z.string().min(1),
    "System.ChangedDate": z.string().min(1),
    "System.Description": z.string().nullish(),
    "System.Tags": z.string().nullish(),
    "System.CreatedBy": z
      .union([
        z.string(),
        z.object({ displayName: z.string() }).transform((creator) => creator.displayName),
      ])
      .nullish()
      .transform((value) => value ?? "Unknown"),
  }),
});
const workItemsSchema = z.object({ value: z.array(workItemSchema) });

const parse = <T>(value: AzureDevOpsJson, schema: z.ZodType<T>, operation: string) =>
  Effect.try({
    try: () => schema.parse(value),
    catch: (cause) =>
      new HostOperationError({
        operation,
        message: `Azure DevOps returned incomplete work item data. Check work item access and retry.`,
        cause,
      }),
  });

const scopeForRepository = (repository: AzureDevOpsRepository): string =>
  `${azureDevOpsCollectionUrl(repository).replace(/\/+$/u, "")}/${repository.project}`.toLowerCase();
const issueApiVersion = (repository: AzureDevOpsRepository): string =>
  repository.deployment === "server" ? "7.0" : "7.1";

const areaPaths = (root: AreaNode, project: string): string[] => {
  const paths: string[] = [];
  const visit = (node: AreaNode, path: string): void => {
    paths.push(path);
    if (node.hasChildren && !node.children) {
      throw new Error(`Area '${path}' has children that Azure DevOps did not return.`);
    }
    for (const child of node.children ?? []) visit(child, `${path}\\${child.name}`);
  };
  visit(root, project);
  return paths;
};

const readAreaPaths = (
  client: AzureDevOpsRestClient,
  config: RepoConfig,
  repository: AzureDevOpsRepository,
) =>
  Effect.gen(function* () {
    const response = yield* client.request(config, repository, {
      operation: "list area paths",
      path: "wit/classificationnodes/Areas",
      apiVersion: issueApiVersion(repository),
      query: { $depth: 20 },
    });
    const root = yield* parse(response.body, areaNodeSchema, "azureDevOps.areas.parse");
    return yield* Effect.try({
      try: () => areaPaths(root, repository.project),
      catch: (cause) =>
        new HostOperationError({
          operation: "azureDevOps.areas.list",
          message: "Azure DevOps did not return the full area tree. Check area access and retry.",
          cause,
        }),
    });
  });

const selectedArea = (config: RepoConfig, paths: string[]) => {
  const configured = config.git.provider?.settings?.areaPath;
  if (!configured) {
    throw new HostValidationError({
      field: "git.provider.settings.areaPath",
      message:
        "Choose an Azure DevOps area path in repository settings before importing work items.",
    });
  }
  const valid = paths.find((path) => path.toLowerCase() === configured.toLowerCase());
  if (!valid) {
    throw new HostValidationError({
      field: "git.provider.settings.areaPath",
      message: `Azure DevOps area '${configured}' is unavailable. Choose a valid area path in repository settings.`,
    });
  }
  return valid;
};

type TypeStates = Map<string, Map<string, string>>;
const readTypeStates = (
  client: AzureDevOpsRestClient,
  config: RepoConfig,
  repository: AzureDevOpsRepository,
) =>
  Effect.gen(function* () {
    const response = yield* client.request(config, repository, {
      operation: "list work item states",
      path: "wit/workitemtypes",
      apiVersion: issueApiVersion(repository),
    });
    const types = yield* parse(response.body, workItemTypesSchema, "azureDevOps.states.parse");
    const states: TypeStates = new Map();
    for (const type of types.value) {
      if (!type.isDisabled) {
        const response = yield* client.request(config, repository, {
          operation: `list states for ${type.name}`,
          path: `wit/workitemtypes/${encodeURIComponent(type.name)}/states`,
          apiVersion: issueApiVersion(repository),
        });
        const typeStates = yield* parse(
          response.body,
          workItemTypeStatesSchema,
          "azureDevOps.states.parse",
        );
        states.set(
          type.name,
          new Map(typeStates.value.map((state) => [state.name, state.category])),
        );
      }
    }
    return states;
  });

const escapeWiql = (value: string): string => value.replaceAll("'", "''");
const openStateClause = (states: TypeStates): string =>
  [...states]
    .flatMap(([type, categories]) => {
      const open = [...categories]
        .filter(([, category]) => category === "Proposed" || category === "InProgress")
        .map(([state]) => `'${escapeWiql(state)}'`);
      return open.length
        ? [
            `([System.WorkItemType] = '${escapeWiql(type)}' AND [System.State] IN (${open.join(", ")}))`,
          ]
        : [];
    })
    .join(" OR ");

const decodeHtml = (text: string): string =>
  text
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&#x27;/giu, "'")
    .replace(/&#(\d+);/gu, (entity: string, decimal: string) => {
      const point = Number(decimal);
      return point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    })
    .replace(/&#x([\da-f]+);/giu, (entity: string, hex: string) => {
      const point = Number.parseInt(hex, 16);
      return point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    });

const readableDescription = (html: string, baseUrl: string): string => {
  if (!html) return "";
  return decodeHtml(
    html
      .replace(
        /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu,
        (_, href: string, label: string) => {
          const decodedHref = decodeHtml(href);
          const url = URL.canParse(decodedHref, baseUrl) ? new URL(decodedHref, baseUrl) : null;
          return url && (url.protocol === "http:" || url.protocol === "https:")
            ? `[${label.replace(/<[^>]+>/gu, "")}](${url.toString()})`
            : label.replace(/<[^>]+>/gu, "");
        },
      )
      .replace(/<br\s*\/?\s*>/giu, "\n")
      .replace(/<\/(p|div|li|h[1-6])\s*>/giu, "\n\n")
      .replace(/<li\b[^>]*>/giu, "- ")
      .replace(/<[^>]+>/gu, ""),
  )
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
};

const toIssue = (
  item: z.infer<typeof workItemSchema>,
  repository: AzureDevOpsRepository,
  area: string,
  states: TypeStates,
): SourceIssue => {
  const fields = item.fields;
  const type = fields["System.WorkItemType"];
  const state = fields["System.State"];
  const category = states.get(type)?.get(state);
  const itemArea = fields["System.AreaPath"];
  if (
    (category !== "Proposed" && category !== "InProgress") ||
    (itemArea.toLowerCase() !== area.toLowerCase() &&
      !itemArea.toLowerCase().startsWith(`${area.toLowerCase()}\\`))
  ) {
    throw new HostValidationError({
      field: "sourceId",
      message: `Azure DevOps work item ${item.id} is no longer open in area '${area}'. Refresh the list.`,
    });
  }
  const creatorName = fields["System.CreatedBy"];
  const tags = fields["System.Tags"] ?? "";
  const collectionUrl = azureDevOpsCollectionUrl(repository).replace(/\/+$/u, "");
  return {
    providerId: "azure_devops",
    scope: scopeForRepository(repository),
    sourceId: String(item.id),
    number: String(item.id),
    url: `${collectionUrl}/${encodeURIComponent(repository.project)}/_workitems/edit/${item.id}`,
    title: fields["System.Title"],
    description: readableDescription(fields["System.Description"] ?? "", collectionUrl),
    creator: creatorName,
    updatedAt: fields["System.ChangedDate"],
    tags: tags
      .split(";")
      .map((tag) => tag.trim())
      .filter(Boolean),
    revision: String(item.rev),
  };
};

const requireAreaAndStates = (
  client: AzureDevOpsRestClient,
  config: RepoConfig,
  repository: AzureDevOpsRepository,
) =>
  Effect.gen(function* () {
    const paths = yield* readAreaPaths(client, config, repository);
    const area = yield* Effect.try({
      try: () => selectedArea(config, paths),
      catch: (cause) =>
        cause instanceof HostValidationError
          ? cause
          : new HostOperationError({ operation: "azureDevOps.area", message: String(cause) }),
    });
    const states = yield* readTypeStates(client, config, repository);
    return { area, states };
  });

const readIssue = (
  client: AzureDevOpsRestClient,
  config: RepoConfig,
  repository: AzureDevOpsRepository,
  area: string,
  states: TypeStates,
  sourceId: string,
) =>
  Effect.gen(function* () {
    if (!/^[1-9]\d*$/u.test(sourceId)) {
      return yield* new HostValidationError({
        field: "sourceId",
        message: "Choose a valid Azure DevOps work item ID.",
      });
    }
    const response = yield* client.request(config, repository, {
      operation: "read work item",
      path: `wit/workitems/${sourceId}`,
      apiVersion: issueApiVersion(repository),
    });
    const item = yield* parse(response.body, workItemSchema, "azureDevOps.workItem.parse");
    return yield* Effect.try({
      try: () => toIssue(item, repository, area, states),
      catch: (cause) =>
        cause instanceof HostValidationError
          ? cause
          : new HostOperationError({
              operation: "azureDevOps.issues.get",
              message: "Azure DevOps returned an incomplete work item. Refresh and try again.",
              cause,
            }),
    });
  });

const prepareAzureIssueGet = (
  client: AzureDevOpsRestClient,
  repositoryPort: GitProviderRepositoryPort<AzureDevOpsRepository>,
  repoConfig: RepoConfig,
) =>
  Effect.gen(function* () {
    const repository = yield* repositoryPort.getRepository(repoConfig);
    const { area, states } = yield* requireAreaAndStates(client, repoConfig, repository);
    return (sourceId: string) => readIssue(client, repoConfig, repository, area, states, sourceId);
  });

export const createAzureDevOpsIssueReader = ({
  client,
  repositoryPort,
}: {
  client: AzureDevOpsRestClient;
  repositoryPort: GitProviderRepositoryPort<AzureDevOpsRepository>;
}): IssueReaderPort => ({
  providerId: "azure_devops",
  scope(repoConfig) {
    return repositoryPort.getRepository(repoConfig).pipe(Effect.map(scopeForRepository));
  },
  list(input) {
    return Effect.gen(function* () {
      const repository = yield* repositoryPort.getRepository(input.repoConfig);
      const { area, states } = yield* requireAreaAndStates(client, input.repoConfig, repository);
      const stateClause = openStateClause(states);
      if (!stateClause) return { items: [], nextPage: undefined };
      const searchClause = input.search.trim()
        ? ` AND [System.Title] CONTAINS '${escapeWiql(input.search.trim())}'`
        : "";
      const query = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${escapeWiql(repository.project)}' AND ([System.AreaPath] = '${escapeWiql(area)}' OR [System.AreaPath] UNDER '${escapeWiql(area)}') AND (${stateClause})${searchClause} ORDER BY [System.ChangedDate] DESC, [System.Id] DESC${input.snapshot ? ` ASOF '${escapeWiql(input.snapshot)}'` : ""}`;
      const wiql = yield* client.request(input.repoConfig, repository, {
        operation: "query open work items",
        path: "wit/wiql",
        apiVersion: issueApiVersion(repository),
        method: "POST",
        query: { $top: input.page * 20 + 1 },
        body: { query },
      });
      const wiqlResult = yield* parse(wiql.body, wiqlResultSchema, "azureDevOps.wiql.parse");
      const snapshot = input.snapshot ?? wiqlResult.asOf;
      const ids = wiqlResult.workItems.map((item) => item.id);
      const pageIds = ids.slice((input.page - 1) * 20, input.page * 20);
      if (pageIds.length === 0) return { items: [], nextPage: undefined };
      const details = yield* client.request(input.repoConfig, repository, {
        operation: "read work items",
        path: "wit/workitems",
        apiVersion: issueApiVersion(repository),
        query: { ids: pageIds.join(","), asOf: snapshot },
      });
      const data = yield* parse(details.body, workItemsSchema, "azureDevOps.workItems.parse");
      const byId = new Map(data.value.map((item) => [item.id, item]));
      const items = yield* Effect.try({
        try: () =>
          pageIds.map((id) => {
            const item = byId.get(id);
            if (!item) throw new Error(`Work item ${id} was missing from the response.`);
            return toIssue(item, repository, area, states);
          }),
        catch: (cause) =>
          cause instanceof HostValidationError
            ? cause
            : new HostOperationError({
                operation: "azureDevOps.issues.list",
                message:
                  "Azure DevOps could not return every work item on this page. Retry the request.",
                cause,
              }),
      });
      return {
        items,
        nextPage: ids.length > input.page * 20 ? input.page + 1 : undefined,
        snapshot,
      };
    });
  },
  get(input) {
    return Effect.gen(function* () {
      if (!/^[1-9]\d*$/u.test(input.sourceId)) {
        return yield* new HostValidationError({
          field: "sourceId",
          message: "Choose a valid Azure DevOps work item ID.",
        });
      }
      const preparedGet = yield* prepareAzureIssueGet(client, repositoryPort, input.repoConfig);
      return yield* preparedGet(input.sourceId);
    });
  },
  prepareGet(repoConfig) {
    return prepareAzureIssueGet(client, repositoryPort, repoConfig);
  },
});

export const createAzureDevOpsAreaPathsReader = ({
  client,
  repositoryPort,
}: {
  client: AzureDevOpsRestClient;
  repositoryPort: GitProviderRepositoryPort<AzureDevOpsRepository>;
}): AzureAreaPathsPort => ({
  list(repoConfig) {
    return Effect.gen(function* () {
      const repository = yield* repositoryPort.getRepository(repoConfig);
      return yield* readAreaPaths(client, repoConfig, repository);
    });
  },
});
