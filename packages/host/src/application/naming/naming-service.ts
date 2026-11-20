import type { RepoConfig } from "@openducktor/contracts";
import {
  buildNamingPrompt,
  promptSettingsOf,
  type NamingAnswer,
  type NamingKind,
} from "@openducktor/workflows";
import { Duration, Effect } from "effect";
import { cleanNamingAnswer } from "../../domain/naming/naming-output";
import { errorMessage } from "../../effect/host-errors";
import type { AgentTextGenerationPort } from "../../ports/agent-text-generation-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";

/** One naming request waits at most this long, because work waits for the name. */
const NAMING_TIMEOUT = Duration.seconds(15);

/** The workspace settings that naming reads: the naming model and the prompt layers. */
export type NamingRepoConfig = Pick<
  RepoConfig,
  "repoPath" | "namingModel" | "promptOverrides" | "promptAppends"
>;

export type NamingRequest<K extends NamingKind> = {
  /** The workspace settings at the start of naming. */
  repoConfig: NamingRepoConfig;
  kind: K;
  workText: string;
};

/**
 * The result of one naming request. `disabled` means that the workspace has no naming model, so
 * no model call happened. A time-out is not an error: the caller uses its current names and shows
 * no notice. A failure has a message that says what failed.
 */
export type NamingOutcome<K extends NamingKind> =
  | { status: "disabled" }
  | { status: "generated"; answer: NamingAnswer<K> }
  | { status: "timed_out" }
  | { status: "failed"; message: string };

export type NamingService = {
  generate<K extends NamingKind>(request: NamingRequest<K>): Effect.Effect<NamingOutcome<K>>;
};

/**
 * Asks the naming model of a workspace for the names of `kind`, in one JSON answer. The request
 * has one attempt and the `NAMING_TIMEOUT` deadline.
 */
export const createNamingService = ({
  textGeneration,
  settingsConfig,
  timeout = NAMING_TIMEOUT,
}: {
  textGeneration: Pick<AgentTextGenerationPort, "generateJson">;
  settingsConfig: Pick<SettingsConfigPort, "readGlobalConfig">;
  timeout?: Duration.Input;
}): NamingService => ({
  generate: <K extends NamingKind>({ repoConfig, kind, workText }: NamingRequest<K>) =>
    Effect.gen(function* () {
      const model = repoConfig.namingModel;
      if (!model) return { status: "disabled" } as const;
      const attempt = Effect.gen(function* () {
        const global = yield* settingsConfig.readGlobalConfig();
        const { instructions, prompt, answerSchema } = yield* Effect.try({
          try: () =>
            buildNamingPrompt({ kind, workText, settings: promptSettingsOf(global, repoConfig) }),
          catch: (cause) => new Error(errorMessage(cause)),
        });
        const answer = yield* textGeneration.generateJson({
          repoPath: repoConfig.repoPath,
          model,
          instructions,
          prompt,
          answerSchema,
        });
        return yield* Effect.try({
          try: () => cleanNamingAnswer(answer),
          catch: (cause) => new Error(errorMessage(cause)),
        });
      });
      return yield* attempt.pipe(
        Effect.timeoutOption(timeout),
        Effect.map((answer): NamingOutcome<K> =>
          answer._tag === "Some"
            ? { status: "generated", answer: answer.value }
            : { status: "timed_out" },
        ),
        Effect.catch((cause) =>
          Effect.succeed<NamingOutcome<K>>({ status: "failed", message: errorMessage(cause) }),
        ),
      );
    }),
});

/** Why naming failed and what the user can do, for a notice in the session or startup. */
export const namingFailureNotice = (message: string, fallback: string): string =>
  `The naming model could not name this work, so OpenDucktor used ${fallback}. ${message} Check the naming model in the workspace settings, or clear it to stop naming.`;
