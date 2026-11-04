import { gitlabResolvedRepositoryIdentity } from "@openducktor/core";
import { Effect } from "effect";
import { z } from "zod";
import type { HostError } from "../../../effect/host-errors";
import type {
  GitlabAuthorization,
  GitlabConnectionPort,
} from "../../../ports/gitlab-connection-port";
import { type GitlabProject, readGitlabProject } from "./account-api";
import { type GitlabHttp, type GitlabHttpResponse, gitlabProblemOf, parseGitlabJson } from "./http";
import type { GitProviderWorkspace } from "../../../ports/git-provider-workspace";

const PAGE_SIZE = 100;

type Query = Readonly<Record<string, string | number | boolean | readonly string[] | undefined>>;

/** The linked account and the resolved project of one repository. */
export type GitlabProjectContext = GitlabAuthorization & {
  project: GitlabProject;
  /** `gitlab::<instanceUrl>::<projectId>`. A project rename keeps it. */
  identity: string;
};

export type GitlabApiRequest = {
  operation: string;
  /** A path below `/api/v4`, such as `/projects/1/merge_requests`. */
  path: string;
  method?: "GET" | "POST" | "PUT" | undefined;
  query?: Query | undefined;
  json?: unknown;
};

export type GitlabRestClient = {
  /** Authorizes the linked account and reads the configured project. */
  resolveProject(repoConfig: GitProviderWorkspace): Effect.Effect<GitlabProjectContext, HostError>;
  /** Sends one request and returns the raw response. */
  send(
    context: GitlabAuthorization,
    request: GitlabApiRequest,
  ): Effect.Effect<GitlabHttpResponse, HostError>;
  /** Sends one request and parses its JSON body. */
  json<Schema extends z.ZodType>(
    context: GitlabAuthorization,
    request: GitlabApiRequest,
    schema: Schema,
  ): Effect.Effect<z.output<Schema>, HostError>;
  /** Reads one page of a list. */
  page<Schema extends z.ZodType>(
    context: GitlabAuthorization,
    request: GitlabApiRequest & { page: number; perPage?: number },
    itemSchema: Schema,
  ): Effect.Effect<{ items: z.output<Schema>[]; nextPage: number | undefined }, HostError>;
  /** Reads every page of a list. */
  pages<Schema extends z.ZodType>(
    context: GitlabAuthorization,
    request: GitlabApiRequest,
    itemSchema: Schema,
  ): Effect.Effect<z.output<Schema>[], HostError>;
};

/** A project API path, such as `/projects/42/merge_requests`. */
export const gitlabProjectPath = (projectId: number, suffix = ""): string =>
  `/projects/${projectId}${suffix}`;

export const createGitlabRestClient = ({
  http,
  connection,
}: {
  http: GitlabHttp;
  connection: GitlabConnectionPort;
}): GitlabRestClient => {
  // A project keeps its ID while its path stays the same, so each port call skips the project
  // read after the first. A request that GitLab denies drops the entry, so a moved or deleted
  // project is read again.
  const projects = new Map<string, GitlabProject>();
  const projectKey = ({ repository, account }: GitlabAuthorization) =>
    `${repository.instanceUrl}\n${repository.projectPath.toLowerCase()}\n${account.accountId}`;

  const send: GitlabRestClient["send"] = (context, request) =>
    http
      .send({
        operation: request.operation,
        instanceUrl: context.repository.instanceUrl,
        path: `/api/v4${request.path}`,
        method: request.method ?? "GET",
        query: request.query,
        json: request.json,
        authorization: context.headerValue,
      })
      .pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            if (gitlabProblemOf(error)?.problem === "project_unreachable")
              projects.delete(projectKey(context));
          }),
        ),
      );

  const json: GitlabRestClient["json"] = (context, request, schema) =>
    send(context, request).pipe(
      Effect.flatMap((response) => parseGitlabJson(request.operation, response, schema)),
    );

  const page: GitlabRestClient["page"] = (context, request, itemSchema) =>
    Effect.gen(function* () {
      const response = yield* send(context, {
        ...request,
        query: { ...request.query, page: request.page, per_page: request.perPage ?? PAGE_SIZE },
      });
      const items = yield* parseGitlabJson(request.operation, response, z.array(itemSchema));
      const next = Number(response.headers.get("x-next-page"));
      return { items, nextPage: Number.isInteger(next) && next > 0 ? next : undefined };
    });

  return {
    resolveProject: (repoConfig) =>
      Effect.gen(function* () {
        const authorization = yield* connection.authorization(repoConfig);
        const key = projectKey(authorization);
        const project =
          projects.get(key) ??
          (yield* readGitlabProject(
            http,
            authorization.repository.instanceUrl,
            authorization.headerValue,
            authorization.repository.projectPath,
          ));
        projects.set(key, project);
        return {
          ...authorization,
          project,
          identity: gitlabResolvedRepositoryIdentity({
            instanceUrl: authorization.repository.instanceUrl,
            projectId: project.id,
          }),
        };
      }),
    send,
    json,
    page,
    pages: (context, request, itemSchema) =>
      Effect.gen(function* () {
        const items: z.output<typeof itemSchema>[] = [];
        let next: number | undefined = 1;
        while (next !== undefined) {
          const result: { items: z.output<typeof itemSchema>[]; nextPage: number | undefined } =
            yield* page(context, { ...request, page: next }, itemSchema);
          items.push(...result.items);
          next = result.nextPage;
        }
        return items;
      }),
  };
};
