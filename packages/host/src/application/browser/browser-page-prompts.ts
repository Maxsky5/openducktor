import { Effect } from "effect";
import { z } from "zod";
import type { CdpEvent, CdpSession } from "../../ports/browser-engine-port";
import {
  evaluateResultSchema,
  fileChooserOpenedSchema,
  javascriptDialogOpeningSchema,
  resolveNodeResultSchema,
} from "../../ports/browser-cdp-schemas";
import type { BrowserPromptBook } from "./browser-prompt-book";
import { BrowserServiceError } from "./browser-service-error";

export type BrowserPagePromptsInput = {
  tabId: string;
  session: CdpSession;
  prompts: BrowserPromptBook;
  isAgentActing(): boolean;
  runJob(job: Effect.Effect<void>): void;
};

/** Turns JS dialogs and file choosers of one page into prompts. */
export const createBrowserPagePrompts = ({
  tabId,
  session,
  prompts,
  isAgentActing,
  runJob,
}: BrowserPagePromptsInput) => {
  const answerDialog = (accept: boolean, promptText: string | undefined) =>
    session
      .send(
        "Page.handleJavaScriptDialog",
        promptText === undefined ? { accept } : { accept, promptText },
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new BrowserServiceError({
              code: "browser_no_dialog",
              operation: "browser.dialog.answer",
              message: "No dialog is open in this tab.",
              tabId,
              cause,
            }),
        ),
        Effect.asVoid,
      );

  const acceptedTypes = (backendNodeId: number | undefined) =>
    backendNodeId === undefined
      ? Effect.succeed<string[]>([])
      : Effect.gen(function* () {
          const resolved = resolveNodeResultSchema.parse(
            yield* session.send("DOM.resolveNode", { backendNodeId }),
          );
          if (resolved.object.objectId === undefined) {
            return [];
          }
          const result = evaluateResultSchema.parse(
            yield* session.send("Runtime.callFunctionOn", {
              objectId: resolved.object.objectId,
              functionDeclaration: "function () { return this.accept || ''; }",
              returnByValue: true,
            }),
          );
          return z
            .string()
            .catch("")
            .parse(result.result.value)
            .split(",")
            .map((part) => part.trim())
            .filter((part) => part.length > 0);
        }).pipe(Effect.orElseSucceed((): string[] => []));

  /**
   * Opens the prompt when the event comes, so an agent action that opened the chooser reports it.
   * The accepted file types of the input follow.
   */
  const openFileChooser = (multiple: boolean, backendNodeId: number | undefined): void => {
    prompts.removeKind(tabId, "file_chooser");
    const prompt = prompts.add(
      tabId,
      { kind: "file_chooser", multiple, accept: [], startedByAgent: isAgentActing() },
      (answer) => {
        if (answer.kind !== "file_chooser" || answer.paths.length === 0) {
          return Effect.void;
        }
        if (backendNodeId === undefined) {
          return Effect.fail(
            new BrowserServiceError({
              code: "browser_action_failed",
              operation: "browser.file_chooser.answer",
              message: "The page closed the file input.",
              tabId,
            }),
          );
        }
        const files = multiple ? answer.paths : answer.paths.slice(0, 1);
        return session.send("DOM.setFileInputFiles", { files, backendNodeId }).pipe(
          Effect.mapError(
            (cause) =>
              new BrowserServiceError({
                code: "browser_action_failed",
                operation: "browser.file_chooser.answer",
                message: `Could not add the files to the page: ${cause.message}`,
                tabId,
                cause,
              }),
          ),
          Effect.asVoid,
        );
      },
    );
    runJob(
      acceptedTypes(backendNodeId).pipe(
        Effect.map((accept) => {
          if (accept.length === 0) return;
          prompts.update(tabId, prompt.promptId, (current) =>
            current.kind === "file_chooser" ? { ...current, accept } : current,
          );
        }),
      ),
    );
  };

  /** Handles one prompt event. Returns false for other events. */
  const handleEvent = (event: CdpEvent): boolean => {
    switch (event.method) {
      case "Page.javascriptDialogOpening": {
        const params = javascriptDialogOpeningSchema.parse(event.params);
        prompts.removeKind(tabId, "dialog");
        prompts.add(
          tabId,
          {
            kind: "dialog",
            type: params.type,
            message: params.message,
            defaultPrompt: params.defaultPrompt ?? "",
            startedByAgent: isAgentActing(),
          },
          (answer) =>
            answer.kind === "dialog" ? answerDialog(answer.accept, answer.promptText) : Effect.void,
        );
        return true;
      }
      case "Page.javascriptDialogClosed":
        prompts.removeKind(tabId, "dialog");
        return true;
      case "Page.fileChooserOpened": {
        const params = fileChooserOpenedSchema.parse(event.params);
        openFileChooser(params.mode === "selectMultiple", params.backendNodeId);
        return true;
      }
      default:
        return false;
    }
  };

  return { handleEvent };
};
