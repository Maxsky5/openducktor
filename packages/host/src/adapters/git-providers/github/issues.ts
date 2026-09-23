import {
  TASK_ASSET_MAX_FILE_BYTES,
  issueImageGetResultSchema,
  type GithubGitProviderRepository,
  type SourceIssue,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { fileTypeFromBuffer } from "file-type";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { z } from "zod";
import { HostOperationError, HostValidationError } from "../../../effect/host-errors";
import type { GitProviderRepositoryPort, IssueReaderPort } from "../../../ports/git-provider-port";
import { runGithubApi, type GithubCli } from "./cli";

const githubIssueSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1),
  body: z.string().nullable(),
  state: z.string(),
  updated_at: z.string(),
  html_url: z.string().url(),
  user: z.object({ login: z.string() }).nullable(),
  labels: z.array(z.object({ name: z.string() })),
  pull_request: z.unknown().optional(),
});
const githubSearchSchema = z.object({
  total_count: z.number().int().nonnegative(),
  incomplete_results: z.boolean(),
  items: z.array(githubIssueSchema),
});
const githubIssueLookupSchema = z.object({
  data: z
    .object({
      repository: z
        .object({
          issue: z
            .object({
              number: z.number().int().positive(),
              title: z.string().min(1),
              body: z.string(),
              state: z.enum(["OPEN", "CLOSED"]),
              updatedAt: z.string(),
              url: z.string().url(),
              author: z.object({ login: z.string() }).nullable(),
              labels: z.object({ nodes: z.array(z.object({ name: z.string() }).nullable()) }),
            })
            .nullable(),
        })
        .nullable(),
    })
    .nullable(),
  errors: z
    .array(
      z.object({
        type: z.string().optional(),
        path: z.array(z.union([z.string(), z.number()])).optional(),
        message: z.string(),
      }),
    )
    .optional(),
});

const scopeForRepository = (repository: GithubGitProviderRepository): string =>
  `${repository.host}/${repository.owner}/${repository.name}`.toLowerCase();

const markdownParser = unified().use(remarkParse);
const htmlImage = /^<img\b(?:[^>"']|"[^"]*"|'[^']*')*>$/iu;

const readableDescription = (body: string): string => {
  if (!/<img\b/iu.test(body)) return body;
  const replacements: Array<{ start: number; end: number; markdown: string }> = [];
  visit(markdownParser.parse(body), "html", (node) => {
    const tag = node.value.trim();
    if (!htmlImage.test(tag)) return;
    const src = /\bsrc\s*=\s*(["'])([\s\S]*?)\1/iu.exec(tag)?.[2]?.replace(/&amp;/giu, "&");
    if (!src || !URL.canParse(src)) return;
    const url = new URL(src);
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    const alt = /\balt\s*=\s*(["'])([\s\S]*?)\1/iu.exec(tag)?.[2] ?? "Image";
    const escapedAlt = alt.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
    const escapedUrl = url.toString().replaceAll("(", "%28").replaceAll(")", "%29");
    replacements.push({ start, end, markdown: `![${escapedAlt}](${escapedUrl})` });
  });
  return replacements.reduceRight(
    (text, replacement) =>
      text.slice(0, replacement.start) + replacement.markdown + text.slice(replacement.end),
    body,
  );
};

const parseIssue = (value: z.infer<typeof githubIssueSchema>, scope: string): SourceIssue => {
  if (value.pull_request !== undefined || value.state !== "open") {
    throw new HostValidationError({
      field: "sourceId",
      message: `GitHub item #${value.number} is not an open Issue. Refresh the list and choose an open Issue.`,
    });
  }
  return {
    providerId: "github",
    scope,
    sourceId: String(value.number),
    number: String(value.number),
    url: value.html_url,
    title: value.title,
    description: readableDescription(value.body ?? ""),
    creator: value.user?.login ?? "Unknown",
    updatedAt: value.updated_at,
    tags: value.labels.map((label) => label.name),
    revision: value.updated_at,
  };
};

const parsePayload = <T>(text: string, schema: z.ZodType<T>, operation: string) =>
  Effect.try({
    try: () => schema.parse(JSON.parse(text)),
    catch: (cause) =>
      new HostOperationError({
        operation,
        message: `GitHub returned invalid Issue data. Retry the request.`,
        cause,
      }),
  });

const imageBodySchema = z.object({ body: z.string().nullable() });

export const createGithubIssueReader = ({
  githubCli,
  repositoryPort,
}: {
  githubCli: GithubCli;
  repositoryPort: GitProviderRepositoryPort<GithubGitProviderRepository>;
}): IssueReaderPort => ({
  providerId: "github",
  scope(repoConfig) {
    return repositoryPort.getRepository(repoConfig).pipe(Effect.map(scopeForRepository));
  },
  list(input) {
    return Effect.gen(function* () {
      const repository = yield* repositoryPort.getRepository(input.repoConfig);
      const scope = scopeForRepository(repository);
      const search = input.search.trim();
      const issueNumber = /^#?([1-9]\d*)$/u.exec(search)?.[1];
      if (issueNumber) {
        if (input.page !== 1) {
          return { items: [], nextPage: undefined, incompleteResults: false };
        }
        const query = `query { repository(owner: ${JSON.stringify(repository.owner)}, name: ${JSON.stringify(repository.name)}) { issue(number: ${issueNumber}) { number title body state updatedAt url author { login } labels(first: 100) { nodes { name } } } } }`;
        const command = yield* githubCli.resolve();
        const result = yield* command.run(
          ["api", "--hostname", repository.host, "graphql", "-f", `query=${query}`],
          { cwd: input.repoConfig.repoPath },
        );
        if (!result.ok && !result.stdout.trim().startsWith("{")) {
          return yield* new HostValidationError({
            field: "gh",
            message:
              result.stderr.trim() || "GitHub issue search failed. Check GitHub access and retry.",
          });
        }
        const response = yield* parsePayload(
          result.stdout,
          githubIssueLookupSchema,
          "github.issues.list",
        );
        const missingIssue =
          response.data?.repository?.issue === null &&
          response.errors?.length === 1 &&
          response.errors[0]?.type === "NOT_FOUND" &&
          response.errors[0].path?.join("/") === "repository/issue";
        if (
          !missingIssue &&
          (!result.ok || response.errors?.length || !response.data?.repository)
        ) {
          return yield* new HostOperationError({
            operation: "github.issues.list",
            message:
              response.errors?.[0]?.message ??
              "GitHub repository is unavailable. Check access in Settings.",
          });
        }
        const issue = response.data?.repository?.issue;
        return {
          items:
            issue?.state === "OPEN"
              ? [
                  {
                    providerId: "github" as const,
                    scope,
                    sourceId: String(issue.number),
                    number: String(issue.number),
                    url: issue.url,
                    title: issue.title,
                    description: readableDescription(issue.body),
                    creator: issue.author?.login ?? "Unknown",
                    updatedAt: issue.updatedAt,
                    tags: issue.labels.nodes.flatMap((label) => (label ? [label.name] : [])),
                    revision: issue.updatedAt,
                  },
                ]
              : [],
          nextPage: undefined,
          incompleteResults: false,
        };
      }
      const query = `repo:${repository.owner}/${repository.name} is:issue is:open${search ? ` in:title ${JSON.stringify(search)}` : ""}`;
      const payload = yield* runGithubApi(githubCli, input.repoConfig.repoPath, repository.host, [
        "api",
        "search/issues",
        "-X",
        "GET",
        "-f",
        `q=${query}`,
        "-f",
        "sort=updated",
        "-f",
        "order=desc",
        "-f",
        "per_page=20",
        "-f",
        `page=${input.page}`,
      ]);
      const response = yield* parsePayload(payload, githubSearchSchema, "github.issues.list");
      const items = yield* Effect.try({
        try: () =>
          response.items
            .filter((item) => item.state === "open" && item.pull_request === undefined)
            .map((item) => parseIssue(item, scope)),
        catch: (cause) =>
          cause instanceof HostValidationError
            ? cause
            : new HostOperationError({
                operation: "github.issues.list",
                message: "GitHub returned an invalid open Issue. Retry the search.",
                cause,
              }),
      });
      const visibleTotal = Math.min(response.total_count, 1_000);
      return {
        items,
        nextPage: input.page * 20 < visibleTotal ? input.page + 1 : undefined,
        incompleteResults: response.incomplete_results || response.total_count > 1_000,
      };
    });
  },
  get(input) {
    return Effect.gen(function* () {
      const repository = yield* repositoryPort.getRepository(input.repoConfig);
      if (!/^[1-9]\d*$/u.test(input.sourceId)) {
        return yield* new HostValidationError({
          field: "sourceId",
          message: "Choose a valid GitHub Issue number.",
        });
      }
      const payload = yield* runGithubApi(githubCli, input.repoConfig.repoPath, repository.host, [
        "api",
        `repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/issues/${input.sourceId}`,
      ]);
      const issue = yield* parsePayload(payload, githubIssueSchema, "github.issues.get");
      return yield* Effect.try({
        try: () => parseIssue(issue, scopeForRepository(repository)),
        catch: (cause) =>
          cause instanceof HostValidationError
            ? cause
            : new HostOperationError({
                operation: "github.issues.get",
                message: "GitHub returned an invalid Issue. Refresh and try again.",
                cause,
              }),
      });
    });
  },
  readImage(input) {
    return Effect.gen(function* () {
      const repository = yield* repositoryPort.getRepository(input.repoConfig);
      if (!/^[1-9]\d*$/u.test(input.sourceId)) {
        return yield* new HostValidationError({
          field: "sourceId",
          message: "Choose a valid GitHub Issue number.",
        });
      }
      if (!URL.canParse(input.url)) {
        return yield* new HostValidationError({
          field: "url",
          message: "This image URL is invalid. Refresh the Issue and try again.",
        });
      }
      const url = new URL(input.url);
      if (
        url.origin !== `https://${repository.host}` ||
        !/^\/user-attachments\/assets\/[a-f\d-]{36}$/iu.test(url.pathname) ||
        url.search ||
        url.hash
      ) {
        return yield* new HostValidationError({
          field: "url",
          message: "This image is not a GitHub Issue attachment for the configured host.",
        });
      }
      const payload = yield* runGithubApi(githubCli, input.repoConfig.repoPath, repository.host, [
        "api",
        `repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/issues/${input.sourceId}`,
      ]);
      const issue = yield* parsePayload(payload, imageBodySchema, "github.issues.readImage");
      if (!issue.body?.includes(input.url)) {
        return yield* new HostValidationError({
          field: "url",
          message: "This image is not in the source Issue. Refresh the Issue and try again.",
        });
      }
      const command = yield* githubCli.resolve();
      const result = yield* command.run(["api", "--hostname", repository.host, input.url], {
        cwd: input.repoConfig.repoPath,
        stdoutEncoding: "base64",
        maxStdoutBytes: TASK_ASSET_MAX_FILE_BYTES,
      });
      if (!result.ok) {
        return yield* new HostValidationError({
          field: "url",
          message:
            result.stderr.trim() ||
            "GitHub could not load this Issue image. Check your GitHub access and retry.",
        });
      }
      const bytes = Buffer.from(result.stdout, "base64");
      const detected = yield* Effect.tryPromise({
        try: () => fileTypeFromBuffer(bytes),
        catch: (cause) =>
          new HostOperationError({
            operation: "github.issues.readImage",
            message: "GitHub image data could not be checked. Retry the image.",
            cause,
          }),
      });
      const mediaType = issueImageGetResultSchema.shape.mediaType.safeParse(detected?.mime);
      if (!mediaType.success) {
        return yield* new HostValidationError({
          field: "url",
          message: "GitHub returned an unsupported image format.",
        });
      }
      return {
        mediaType: mediaType.data,
        bytesBase64: result.stdout,
      };
    });
  },
});
