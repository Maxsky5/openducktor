import type { BrowserPromptAnswer, BrowserTabSummary } from "@openducktor/contracts";
import { type ReactElement, useCallback } from "react";
import type { HostClient } from "@openducktor/host-client";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import type { WebviewBrowserBridge } from "@/lib/shell-bridge";
import type { BrowserPromptOf } from "./components/browser-component-types";
import { BrowserDialogPrompt } from "./components/browser-dialog-prompt";
import { BrowserFileChooserBar } from "./components/browser-file-chooser-bar";
import { BrowserPermissionBar } from "./components/browser-permission-bar";
import { useBrowserAsyncAction } from "./components/use-browser-async-action";
import { useBrowserRuntime } from "./browser-runtime";

/** Permission and file prompts of a tab. They show as bars between the toolbar and the page. */
export function BrowserTabPromptBars({
  tab,
  bridge,
}: {
  tab: BrowserTabSummary;
  bridge: WebviewBrowserBridge;
}): ReactElement {
  const hostClient = useHostClient();
  return (
    <>
      {tab.prompts.map((prompt) => {
        if (prompt.kind === "permission") {
          return (
            <BrowserPermissionBar
              key={prompt.promptId}
              prompt={prompt}
              onAnswer={(allow) =>
                answerBrowserPrompt(hostClient, tab.tabId, prompt.promptId, {
                  kind: "permission",
                  allow,
                })
              }
            />
          );
        }
        if (prompt.kind === "file_chooser") {
          return (
            <FileChooserBar
              key={prompt.promptId}
              tabId={tab.tabId}
              prompt={prompt}
              bridge={bridge}
            />
          );
        }
        return null;
      })}
    </>
  );
}

/** The dialog of a tab. It draws over the page in its overlay. */
export function BrowserTabPromptOverlays({ tab }: { tab: BrowserTabSummary }): ReactElement | null {
  const { focus } = useBrowserRuntime();
  const hostClient = useHostClient();
  const { tabId } = tab;
  const returnFocus = useCallback(
    () => focus.focusPage(tabId, { fromKeyboard: false }),
    [focus, tabId],
  );
  const dialog = tab.prompts.find(
    (prompt): prompt is BrowserPromptOf<"dialog" | "leave_page"> =>
      prompt.kind === "dialog" || prompt.kind === "leave_page",
  );
  return dialog ? (
    <BrowserDialogPrompt
      key={dialog.promptId}
      prompt={dialog}
      pageUrl={tab.url}
      onAnswer={(answer) => answerBrowserPrompt(hostClient, tab.tabId, dialog.promptId, answer)}
      returnFocus={returnFocus}
    />
  ) : null;
}

/** Answers a file chooser with the OS file dialog. */
function FileChooserBar({
  tabId,
  prompt,
  bridge,
}: {
  tabId: string;
  prompt: BrowserPromptOf<"file_chooser">;
  bridge: WebviewBrowserBridge;
}): ReactElement {
  const action = useBrowserAsyncAction();
  const hostClient = useHostClient();
  const answer = (paths: string[]) =>
    answerBrowserPrompt(hostClient, tabId, prompt.promptId, { kind: "file_chooser", paths });
  return (
    <BrowserFileChooserBar
      prompt={prompt}
      busy={action.pending}
      error={action.error}
      onCancel={() => void action.run(() => answer([]))}
      onChooseFiles={() =>
        void action.run(async () => {
          const paths = await bridge.pickFiles({
            multiple: prompt.multiple,
            accept: prompt.accept,
          });
          // A closed OS dialog keeps the bar, so the user can choose again or cancel.
          if (paths.length > 0) await answer(paths);
        })
      }
    />
  );
}

const answerBrowserPrompt = (
  client: HostClient,
  tabId: string,
  promptId: string,
  answer: BrowserPromptAnswer,
): Promise<void> => client.browserPromptAnswer({ tabId, promptId, answer });
