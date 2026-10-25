import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useCallback } from "react";
import { Linking } from "react-native";
import { useFeedbackStore } from "@/app-shell/app-services";
import { classifyLink } from "./link-policy";

/** Opens a file link that a Markdown view shows. The path is decoded and can be absolute. */
export type FileLinkHandler = (path: string) => void;

/**
 * Returns the press handler of Markdown links. Web and email links open in the device browser or
 * mail app, file links go to `onFileLinkPress`, and other links show the reason they stay closed.
 * No link opens inside a WebView.
 */
export const useLinkOpener = (
  onFileLinkPress: FileLinkHandler | undefined,
): ((href: string) => void) => {
  const { feedback } = useFeedbackStore();
  return useCallback(
    (href: string) => {
      const target = classifyLink(href);
      switch (target.kind) {
        case "external":
          Linking.openURL(target.url).catch((cause) =>
            feedback.show("error", "The link did not open.", { description: errorMessage(cause) }),
          );
          return;
        case "file":
          if (onFileLinkPress === undefined) {
            feedback.show("warning", "This view cannot open file links.", {
              description: `Open ${target.path} from the task files.`,
            });
            return;
          }
          onFileLinkPress(target.path);
          return;
        case "rejected":
          feedback.show("warning", "The link did not open.", { description: target.reason });
          return;
      }
    },
    [feedback, onFileLinkPress],
  );
};
