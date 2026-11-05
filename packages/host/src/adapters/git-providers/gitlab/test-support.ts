import type { GitlabAccount, GitlabRepository, RepoConfig } from "@openducktor/contracts";
import { Effect } from "effect";
import type { GitlabConnectionPort } from "../../../ports/gitlab-connection-port";
import type { GitProviderFetch } from "../git-provider-fetch";
import { createGitlabHttp } from "./http";
import { createGitlabRestClient, type GitlabRestClient } from "./rest-client";

export const INSTANCE_URL = "https://gitlab.example.com";
export const PROJECT_ID = 42;
export const PROJECT_PATH = "group/app";
export const PROJECT_WEB_URL = `${INSTANCE_URL}/${PROJECT_PATH}`;
export const PROJECT_IDENTITY = `gitlab::${INSTANCE_URL}::${PROJECT_ID}`;

export const gitlabTestRepository: GitlabRepository = {
  providerId: "gitlab",
  instanceUrl: INSTANCE_URL,
  projectPath: PROJECT_PATH,
};

export const gitlabTestRepoConfig: RepoConfig = {
  workspaceId: "workspace-1",
  workspaceName: "OpenDucktor",
  repoPath: "/repo",
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {
    provider: {
      id: "gitlab",
      enabled: true,
      autoDetected: false,
      repository: gitlabTestRepository,
    },
  },
  hooks: { beforeWorktreeRemoval: [] },
  actions: { items: [], defaultActionId: null },
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
  agentStudioState: { openTaskIds: [] },
};

const account: GitlabAccount = {
  accountId: "0b9d3f0e-58f4-4b64-9d4e-5bb4f7f0e001",
  instanceUrl: INSTANCE_URL,
  userId: 7,
  username: "duck",
  displayName: "Duck",
  authKind: "token",
  tokenExpiresAt: null,
};

const unexpected = (name: string) => () => Effect.die(new Error(`unexpected ${name} call`));

const connection: GitlabConnectionPort = {
  listAccounts: unexpected("listAccounts"),
  addToken: unexpected("addToken"),
  startSignIn: unexpected("startSignIn"),
  pollSignIn: unexpected("pollSignIn"),
  status: unexpected("status"),
  authorization: () =>
    Effect.succeed({ repository: gitlabTestRepository, account, headerValue: "Bearer secret" }),
  release: unexpected("release"),
  sweep: unexpected("sweep"),
  knownInstances: unexpected("knownInstances"),
};

export type FakeGitlabRequest = {
  method: string;
  /** The path below `/api/v4`, with its encoding kept. */
  path: string;
  query: URLSearchParams;
  json: unknown;
};

export type FakeGitlabResponse = {
  status?: number;
  json?: unknown;
  bytes?: Uint8Array<ArrayBuffer>;
  headers?: Record<string, string>;
};

const PROJECT_READ = `GET /projects/${encodeURIComponent(PROJECT_PATH)}`;

/**
 * A GitLab REST client whose requests reach `routes`, keyed by `METHOD /path`. A `METHOD /path/*`
 * key answers each path one level below `/path` without its own route. The project read
 * answers by default. A request without a route answers 404.
 */
export const createFakeGitlab = (routes: Record<string, FakeGitlabResponse>) => {
  const requests: FakeGitlabRequest[] = [];
  const allRoutes = new Map<string, FakeGitlabResponse>([
    [
      PROJECT_READ,
      { json: { id: PROJECT_ID, path_with_namespace: PROJECT_PATH, web_url: PROJECT_WEB_URL } },
    ],
    ...Object.entries(routes),
  ]);
  const fetchImplementation: GitProviderFetch = async (input, init) => {
    const url = new URL(String(input));
    const request: FakeGitlabRequest = {
      method: init?.method ?? "GET",
      path: url.pathname.replace(/^\/api\/v4/u, ""),
      query: url.searchParams,
      json: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    requests.push(request);
    const parent = request.path.slice(0, request.path.lastIndexOf("/"));
    const response = allRoutes.get(`${request.method} ${request.path}`) ??
      allRoutes.get(`${request.method} ${parent}/*`) ?? {
        status: 404,
        json: { message: "404 Not Found" },
      };
    const body: BodyInit = response.bytes ?? JSON.stringify(response.json ?? null);
    return new Response(body, { status: response.status ?? 200, headers: response.headers ?? {} });
  };
  const client: GitlabRestClient = createGitlabRestClient({
    http: createGitlabHttp(fetchImplementation),
    connection,
  });
  return { client, requests };
};

/** The requests other than the project read. */
export const apiRequests = (requests: readonly FakeGitlabRequest[]): string[] =>
  requests
    .filter((request) => `${request.method} ${request.path}` !== PROJECT_READ)
    .map((request) => `${request.method} ${request.path}`);
