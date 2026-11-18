import type { RepoConfig } from "@openducktor/contracts";
import { buildNamingPrompt, promptSettingsOf, type NamingOutputs } from "@openducktor/workflows";
import { Duration, Effect } from "effect";
import { parseNamingOutput, type NamingOutputFields } from "../../domain/naming/naming-output";
import { errorMessage } from "../../effect/host-errors";
import type { AgentTextGenerationPort } from "../../ports/agent-text-generation-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";

/** One naming request waits at most this long, because work waits for the name. */
const NAMING_TIMEOUT = Duration.seconds(15);

export type NamingRequest = {
  /** The workspace settings at the start of naming, with its naming model and prompt layers. */
  repoConfig: Pick<RepoConfig, "repoPath" | "namingModel" | "promptOverrides" | "promptAppends">;
  outputs: NamingOutputs;
  workText: string;
};

/**
 * The result of one naming request. `disabled` means that the workspace has no naming model, so
 * no model call happened. A time-out is not an error: the caller uses its current names and shows
 * no notice. A failure has a message that says what failed.
 */
export type NamingOutcome =
  | { kind: "disabled" }
  | ({ kind: "generated" } & NamingOutputFields)
  | { kind: "timed_out" }
  | { kind: "failed"; message: string };

export type NamingService = {
  generate(request: NamingRequest): Effect.Effect<NamingOutcome>;
};

/**
 * Asks the naming model of a workspace for a title, a branch name, or both, in one request. The
 * request has one attempt and the `NAMING_TIMEOUT` deadline.
 */
export const createNamingService = ({
  textGeneration,
  settingsConfig,
  timeout = NAMING_TIMEOUT,
}: {
  textGeneration: AgentTextGenerationPort;
  settingsConfig: Pick<SettingsConfigPort, "readGlobalConfig">;
  timeout?: Duration.Input;
}): NamingService => ({
  generate: ({ repoConfig, outputs, workText }) =>
    Effect.gen(function* () {
      const selection = repoConfig.namingModel;
      if (!selection) return { kind: "disabled" } as const;
      const attempt = Effect.gen(function* () {
        const global = yield* settingsConfig.readGlobalConfig();
        const { instructions, prompt } = yield* Effect.try({
          try: () =>
            buildNamingPrompt({
              outputs,
              workText,
              settings: promptSettingsOf(global, repoConfig),
            }),
          catch: (cause) => new Error(errorMessage(cause)),
        });
        const text = yield* textGeneration.generate({
          repoPath: repoConfig.repoPath,
          model: selection,
          instructions,
          prompt,
        });
        return yield* Effect.try({
          try: () => parseNamingOutput(text, outputs),
          catch: (cause) => new Error(errorMessage(cause)),
        });
      });
      return yield* attempt.pipe(
        Effect.timeoutOption(timeout),
        Effect.map((fields): NamingOutcome =>
          fields._tag === "Some" ? { kind: "generated", ...fields.value } : { kind: "timed_out" },
        ),
        Effect.catch((cause) =>
          Effect.succeed<NamingOutcome>({ kind: "failed", message: errorMessage(cause) }),
        ),
      );
    }),
});

/** Why naming failed and what the user can do, for a notice in the session or startup. */
export const namingFailureNotice = (message: string, fallback: string): string =>
  `The naming model could not name this work, so OpenDucktor used ${fallback}. ${message} Check the naming model in the workspace settings, or clear it to stop naming.`;
