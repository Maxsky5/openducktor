import { TASK_ASSET_MAX_FILE_BYTES, type SourceIssue } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../../effect/host-errors";
import { detectIssueImageMediaType } from "../issue-image";
import type { IssueReaderPort } from "../../../ports/git-provider-port";
import { type GitlabIssue, gitlabIssueSchema } from "./models";
import { type GitlabProjectContext, type GitlabRestClient, gitlabProjectPath } from "./rest-client";

const PAGE_SIZE = 20;
const IMPORTABLE_TYPES = new Set(["issue", "incident"]);
const ISSUE_NUMBER = /^[1-9]\d*$/u;
const UPLOAD_LINK = /\]\(\/uploads\/([0-9a-f]{32})\/([^)\s]+)\)/gu;
const UPLOAD_PATH = /^([0-9a-f]{32})\/([^/]+)$/u;

const projectWebUrl = (context: GitlabProjectContext): string =>
  `${context.repository.instanceUrl}/${context.project.path_with_namespace}`;

/** GitLab writes uploads as `/uploads/<secret>/<file>` links. Imported text needs full URLs. */
const readableDescription = (description: string, context: GitlabProjectContext): string =>
  description.replace(
    UPLOAD_LINK,
    (_link, secret: string, file: string) =>
      `](${projectWebUrl(context)}/uploads/${secret}/${file})`,
  );

const isImportable = (issue: GitlabIssue): boolean =>
  issue.state === "opened" && IMPORTABLE_TYPES.has(issue.issue_type);

const toSourceIssue = (issue: GitlabIssue, context: GitlabProjectContext): SourceIssue => ({
  providerId: "gitlab",
  scope: context.identity,
  sourceId: String(issue.iid),
  number: String(issue.iid),
  url: issue.web_url,
  title: issue.title,
  description: readableDescription(issue.description ?? "", context),
  creator: issue.author?.username ?? "Unknown",
  updatedAt: issue.updated_at,
  tags: issue.labels,
  revision: issue.updated_at,
});

const requireIssueNumber = (sourceId: string) =>
  ISSUE_NUMBER.test(sourceId)
    ? Effect.void
    : Effect.fail(
        new HostValidationError({
          field: "sourceId",
          message: "Choose a valid GitLab issue number.",
        }),
      );

const fetchIssue = (client: GitlabRestClient, context: GitlabProjectContext, sourceId: string) =>
  requireIssueNumber(sourceId).pipe(
    Effect.andThen(
      client.json(
        context,
        {
          operation: "read issue",
          path: gitlabProjectPath(context.project.id, `/issues/${sourceId}`),
        },
        gitlabIssueSchema,
      ),
    ),
  );

const readIssue = (client: GitlabRestClient, context: GitlabProjectContext, sourceId: string) =>
  fetchIssue(client, context, sourceId).pipe(
    Effect.flatMap((issue) =>
      isImportable(issue)
        ? Effect.succeed(toSourceIssue(issue, context))
        : Effect.fail(
            new HostValidationError({
              field: "sourceId",
              message: `GitLab item #${issue.iid} is not an open issue or incident. Refresh the list and choose an open issue.`,
            }),
          ),
    ),
  );

/** The secret and the file name of an upload URL of the configured project, or null. */
const uploadOf = (
  url: URL,
  context: GitlabProjectContext,
): { secret: string; file: string } | null => {
  if (url.search || url.hash) return null;
  const prefixes = [
    `${projectWebUrl(context)}/uploads/`,
    `${context.repository.instanceUrl}/-/project/${context.project.id}/uploads/`,
  ];
  const prefix = prefixes.find((value) => url.href.startsWith(value));
  const match = prefix ? UPLOAD_PATH.exec(url.href.slice(prefix.length)) : null;
  return match?.[1] && match[2] ? { secret: match[1], file: match[2] } : null;
};

/** `#12` or `12` selects issue 12. Other text searches issue titles. */
const issueSearchFilter = (search: string) => {
  const issueNumber = /^#?([1-9]\d*)$/u.exec(search)?.[1];
  if (issueNumber) return { "iids[]": [issueNumber] };
  if (search) return { search, in: "title" };
  return {};
};

export const createGitlabIssueReader = ({
  client,
}: {
  client: GitlabRestClient;
}): IssueReaderPort => ({
  providerId: "gitlab",
  scope: (repoConfig) =>
    client.resolveProject(repoConfig).pipe(Effect.map((context) => context.identity)),
  list: (input) =>
    Effect.gen(function* () {
      const context = yield* client.resolveProject(input.repoConfig);
      const search = input.search.trim();
      const result = yield* client.page(
        context,
        {
          operation: "list issues",
          path: gitlabProjectPath(context.project.id, "/issues"),
          query: { state: "opened", order_by: "updated_at", ...issueSearchFilter(search) },
          page: input.page,
          perPage: PAGE_SIZE,
        },
        gitlabIssueSchema,
      );
      return {
        items: result.items.filter(isImportable).map((issue) => toSourceIssue(issue, context)),
        nextPage: result.nextPage,
      };
    }),
  get: (input) =>
    client
      .resolveProject(input.repoConfig)
      .pipe(Effect.flatMap((context) => readIssue(client, context, input.sourceId))),
  prepareGet: (repoConfig) =>
    client
      .resolveProject(repoConfig)
      .pipe(Effect.map((context) => (sourceId: string) => readIssue(client, context, sourceId))),
  readImage: (input) =>
    Effect.gen(function* () {
      const context = yield* client.resolveProject(input.repoConfig);
      yield* requireIssueNumber(input.sourceId);
      const upload = URL.canParse(input.url) ? uploadOf(new URL(input.url), context) : null;
      if (!upload)
        return yield* Effect.fail(
          new HostValidationError({
            field: "url",
            message: `This image is not an upload of the GitLab project ${context.project.path_with_namespace}. Open it in GitLab instead.`,
          }),
        );
      const description =
        input.savedDescription ??
        readableDescription(
          (yield* fetchIssue(client, context, input.sourceId)).description ?? "",
          context,
        );
      if (!description.includes(input.url))
        return yield* Effect.fail(
          new HostValidationError({
            field: "url",
            message:
              input.savedDescription === undefined
                ? "This image is not in the source issue. Refresh the issue and try again."
                : "This image is not in the saved task description. Refresh the task and try again.",
          }),
        );
      const response = yield* client.send(context, {
        operation: "read issue image",
        path: gitlabProjectPath(context.project.id, `/uploads/${upload.secret}/${upload.file}`),
      });
      if (response.body.byteLength > TASK_ASSET_MAX_FILE_BYTES)
        return yield* Effect.fail(
          new HostValidationError({
            field: "url",
            message: `This GitLab image is larger than ${TASK_ASSET_MAX_FILE_BYTES / 1024 / 1024} MiB. Open it in GitLab instead.`,
          }),
        );
      const bytes = new Uint8Array(response.body);
      const mediaType = yield* detectIssueImageMediaType(bytes, {
        label: "GitLab",
        operation: "gitlab.issues.readImage",
        unsupportedMessage:
          "GitLab returned an unsupported image format. Use PNG, JPEG, GIF, or WebP.",
      });
      return { mediaType, bytesBase64: Buffer.from(bytes).toString("base64") };
    }),
});
