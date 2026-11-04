import type { PullRequestReviewActivity } from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage, type HostError } from "../../../effect/host-errors";
import {
  type GitlabDiscussion,
  type GitlabMergeRequestDetail,
  type GitlabNote,
  type GitlabPosition,
  type GitlabUserBasic,
  gitlabDiscussionSchema,
  gitlabVersionDiffsSchema,
  gitlabVersionSchema,
} from "./models";
import { fileSuggestionPatch } from "../suggestion-patch";
import { type GitlabProjectContext, type GitlabRestClient, gitlabProjectPath } from "./rest-client";

const CONTEXT_LINES = 3;
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u;
// GitLab 17.7+ wraps a suggestion that contains a code block in a longer fence. The block ends at
// a line with the same fence, so a shorter inner fence stays part of the suggestion.
const SUGGESTION_BLOCK =
  /^(`{3,})suggestion(?::-(\d+)\+(\d+))?[ \t]*\r?\n([\s\S]*?)^\1[ \t]*\r?$/gmu;

type DiffDiscussion = { discussion: GitlabDiscussion; position: GitlabPosition };
type SuggestionFile = { content: string | null; warning: string | null };
type NoteContent = Pick<
  PullRequestReviewActivity,
  "body" | "suggestionPatches" | "suggestionWarning"
>;

export const urlOrNull = (value: string | null | undefined): string | null =>
  value && URL.canParse(value) ? value : null;

const splitLines = (text: string): string[] =>
  text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");

const diffPosition = (discussion: GitlabDiscussion): GitlabPosition | null =>
  discussion.notes.find((note) => note.type === "DiffNote" && note.position)?.position ?? null;

const hasSuggestion = (body: string): boolean => {
  SUGGESTION_BLOCK.lastIndex = 0;
  return SUGGESTION_BLOCK.test(body);
};

type DiffLine = { text: string; oldLine: number; newLine: number; hunk: number };

/**
 * Cuts the commented line and the lines above it in its hunk from a GitLab file diff, in the
 * format of a GitHub `diff_hunk`.
 */
const cutGitlabDiffHunk = (diff: string, position: GitlabPosition): string | null => {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let hunk = -1;
  for (const text of splitLines(diff)) {
    const header = HUNK_HEADER.exec(text);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      hunk += 1;
      continue;
    }
    const prefix = text.at(0);
    if (hunk < 0 || (prefix !== " " && prefix !== "-" && prefix !== "+")) continue;
    lines.push({ text, oldLine, newLine, hunk });
    if (prefix !== "+") oldLine += 1;
    if (prefix !== "-") newLine += 1;
  }
  const target = lines.findIndex((line) =>
    position.new_line
      ? line.text.at(0) !== "-" && line.newLine === position.new_line
      : line.text.at(0) !== "+" && line.oldLine === position.old_line,
  );
  const targetLine = lines[target];
  if (!targetLine) return null;
  let start = target;
  while (start > 0 && target - start < CONTEXT_LINES && lines[start - 1]?.hunk === targetLine.hunk)
    start -= 1;
  const window = lines.slice(start, target + 1);
  const first = window[0] ?? targetLine;
  const oldCount = window.filter((line) => line.text.at(0) !== "+").length;
  const newCount = window.filter((line) => line.text.at(0) !== "-").length;
  const oldStart = oldCount === 0 ? first.oldLine - 1 : first.oldLine;
  const newStart = newCount === 0 ? first.newLine - 1 : first.newLine;
  return [
    `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
    ...window.map((line) => line.text),
  ].join("\n");
};

/** Reads each merge request version that a diff discussion uses once, then cuts its hunk. */
const readDiffHunks = (
  client: GitlabRestClient,
  context: GitlabProjectContext,
  iid: number,
  diffDiscussions: readonly DiffDiscussion[],
): Effect.Effect<Map<string, string | null>, HostError> =>
  Effect.gen(function* () {
    if (diffDiscussions.length === 0) return new Map();
    const versionsPath = gitlabProjectPath(context.project.id, `/merge_requests/${iid}/versions`);
    const versions = yield* client.pages(
      context,
      { operation: "read pull request versions", path: versionsPath },
      gitlabVersionSchema,
    );
    const versionOf = ({ position }: DiffDiscussion) =>
      versions.find(
        (version) =>
          version.head_commit_sha === position.head_sha &&
          version.base_commit_sha === position.base_sha &&
          version.start_commit_sha === position.start_sha,
      )?.id;
    const versionIds = [...new Set(diffDiscussions.flatMap((entry) => versionOf(entry) ?? []))];
    const versionDiffs = new Map(
      yield* Effect.forEach(
        versionIds,
        (versionId) =>
          client
            .json(
              context,
              {
                operation: "read pull request version diff",
                path: `${versionsPath}/${versionId}`,
              },
              gitlabVersionDiffsSchema,
            )
            .pipe(Effect.map((version) => [versionId, version.diffs] as const)),
        { concurrency: 4 },
      ),
    );
    return new Map(
      diffDiscussions.map((entry) => {
        const versionId = versionOf(entry);
        const fileDiff = (versionId === undefined ? undefined : versionDiffs.get(versionId))?.find(
          (diff) =>
            entry.position.new_path
              ? diff.new_path === entry.position.new_path
              : diff.old_path === entry.position.old_path,
        );
        return [
          entry.discussion.id,
          fileDiff ? cutGitlabDiffHunk(fileDiff.diff, entry.position) : null,
        ] as const;
      }),
    );
  });

const suggestionFileKey = (sha: string, path: string): string => `${sha}\n${path}`;

/** Reads each file that a suggestion changes once, at the commit of its comment. */
const readSuggestionFiles = (
  client: GitlabRestClient,
  context: GitlabProjectContext,
  diffDiscussions: readonly DiffDiscussion[],
): Effect.Effect<Map<string, SuggestionFile>> => {
  const files = new Map<string, { sha: string; path: string }>();
  for (const { discussion, position } of diffDiscussions) {
    if (!position.head_sha || !position.new_path || !position.new_line) continue;
    if (!discussion.notes.some((note) => !note.system && hasSuggestion(note.body))) continue;
    files.set(suggestionFileKey(position.head_sha, position.new_path), {
      sha: position.head_sha,
      path: position.new_path,
    });
  }
  return Effect.forEach(
    [...files],
    ([key, { sha, path }]) =>
      client
        .send(context, {
          operation: "read suggestion file",
          path: gitlabProjectPath(
            context.project.id,
            `/repository/files/${encodeURIComponent(path)}/raw`,
          ),
          query: { ref: sha },
        })
        .pipe(
          Effect.map((response): SuggestionFile => ({
            content: new TextDecoder().decode(response.body),
            warning: null,
          })),
          Effect.catch((cause) =>
            Effect.succeed<SuggestionFile>({
              content: null,
              warning: `GitLab suggestion source could not be loaded: ${errorMessage(cause)}`,
            }),
          ),
          Effect.map((file) => [key, file] as const),
        ),
    { concurrency: 4 },
  ).pipe(Effect.map((entries) => new Map(entries)));
};

const LOCATION_WARNING =
  "GitLab suggestion lines could not be located in the source file. Open the thread in GitLab to view it.";

/** Turns each ```` ```suggestion:-N+M ```` block into a patch of the lines that it replaces. */
const parseGitlabNoteContent = (
  body: string,
  position: GitlabPosition,
  file: SuggestionFile | undefined,
): NoteContent => {
  const blocks: { above: number; below: number; replacement: string }[] = [];
  SUGGESTION_BLOCK.lastIndex = 0;
  const markdownBody = body
    .replace(
      SUGGESTION_BLOCK,
      (_block, _fence: string, above?: string, below?: string, replacement = "") => {
        blocks.push({
          above: Number(above ?? 0),
          below: Number(below ?? 0),
          replacement: replacement.replace(/\r?\n$/u, ""),
        });
        return "";
      },
    )
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  if (blocks.length === 0)
    return { body: markdownBody, suggestionPatches: [], suggestionWarning: null };
  const keep = (suggestionWarning: string): NoteContent => ({
    body: body.trim(),
    suggestionPatches: [],
    suggestionWarning,
  });
  const line = position.new_line;
  if (!line)
    return keep(
      "GitLab suggestions apply only to lines of the new file. Open the thread in GitLab to view it.",
    );
  if (!file?.content) return keep(file?.warning ?? LOCATION_WARNING);
  const content = file.content.replace(/\r?\n$/u, "");
  const suggestionPatches: string[] = [];
  for (const block of blocks) {
    const patch = fileSuggestionPatch(
      content,
      line - block.above,
      line + block.below,
      block.replacement,
    );
    if (!patch) return keep(LOCATION_WARNING);
    suggestionPatches.push(patch);
  }
  return { body: markdownBody, suggestionPatches, suggestionWarning: null };
};

const noteFields = (note: GitlabNote, mergeRequestUrl: string) => ({
  id: String(note.id),
  author: note.author.username,
  authorAvatarUrl: urlOrNull(note.author.avatar_url),
  url: `${mergeRequestUrl}#note_${note.id}`,
  createdAt: note.created_at ?? null,
  updatedAt: note.updated_at ?? null,
  isResolved: note.resolvable === true ? note.resolved === true : null,
});

export type GitlabDiscussionActivities = {
  comments: PullRequestReviewActivity[];
  openThreadCount: number;
  /** The authors of the comments. */
  authors: GitlabUserBasic[];
};

/** Reads the discussions of a merge request. System notes, such as label changes, stay out. */
export const readGitlabDiscussionActivities = (
  client: GitlabRestClient,
  context: GitlabProjectContext,
  mergeRequest: GitlabMergeRequestDetail,
): Effect.Effect<GitlabDiscussionActivities, HostError> =>
  Effect.gen(function* () {
    const discussions = yield* client.pages(
      context,
      {
        operation: "read pull request discussions",
        path: gitlabProjectPath(
          context.project.id,
          `/merge_requests/${mergeRequest.iid}/discussions`,
        ),
      },
      gitlabDiscussionSchema,
    );
    const diffDiscussions = discussions.flatMap((discussion) => {
      const position = diffPosition(discussion);
      return position ? [{ discussion, position }] : [];
    });
    const [hunks, files] = yield* Effect.all(
      [
        readDiffHunks(client, context, mergeRequest.iid, diffDiscussions),
        readSuggestionFiles(client, context, diffDiscussions),
      ],
      { concurrency: 2 },
    );
    const positions = new Map(
      diffDiscussions.map((entry) => [entry.discussion.id, entry.position]),
    );
    const comments = discussions.flatMap((discussion) => {
      const position = positions.get(discussion.id);
      return discussion.notes
        .filter((note) => !note.system)
        .map((note): PullRequestReviewActivity => {
          const fields = noteFields(note, mergeRequest.web_url);
          if (!position)
            return {
              ...fields,
              source: "comment",
              body: note.body,
              patch: null,
              suggestionPatches: [],
              suggestionWarning: null,
              path: null,
              line: null,
              threadId: discussion.individual_note ? null : discussion.id,
            };
          const file =
            position.head_sha && position.new_path
              ? files.get(suggestionFileKey(position.head_sha, position.new_path))
              : undefined;
          return {
            ...fields,
            ...parseGitlabNoteContent(note.body, position, file),
            source: "review_thread",
            patch: hunks.get(discussion.id) ?? null,
            path: position.new_path ?? position.old_path ?? null,
            line: position.new_line ?? position.old_line ?? null,
            threadId: discussion.id,
          };
        });
    });
    return {
      comments,
      authors: discussions.flatMap((discussion) =>
        discussion.notes.filter((note) => !note.system).map((note) => note.author),
      ),
      openThreadCount: discussions.filter((discussion) =>
        discussion.notes.some((note) => note.resolvable === true && note.resolved !== true),
      ).length,
    };
  });
