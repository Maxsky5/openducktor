import {
  browserAnnotationCaptureRequestSchema,
  browserDownloadRefSchema,
  browserPickerSetRequestSchema,
  browserPromptAnswerRequestSchema,
  browserSitePermissionsRequestSchema,
  browserSitePermissionsResetRequestSchema,
  browserTabFrameStateRequestSchema,
  browserTabNavigateRequestSchema,
  browserTabOpenRequestSchema,
  browserTabRefSchema,
  browserTabSetSharedRequestSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { z } from "zod";
import type { BrowserService } from "../../application/browser/browser-service-types";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import { commandInputRecordSchema, type HostCommandArgs, requireRecord } from "./command-inputs";

export const createBrowserCommandHandlers = (browser: BrowserService) =>
  ({
    browser_state_read: () => Effect.sync(() => browser.state()),
    browser_tabs_list: () => browser.listTabs().pipe(Effect.map((tabs) => ({ tabs }))),
    browser_tab_open: (args) =>
      browser.openTab(parseInput(browserTabOpenRequestSchema, args, "browser_tab_open")),
    browser_tab_start: (args) =>
      browser.startTab(parseInput(browserTabRefSchema, args, "browser_tab_start").tabId),
    browser_tab_frame_state: (args) =>
      browser.reportFrameState(
        parseInput(browserTabFrameStateRequestSchema, args, "browser_tab_frame_state"),
      ),
    browser_tab_close: (args) =>
      browser.closeTab(parseInput(browserTabRefSchema, args, "browser_tab_close").tabId),
    browser_tab_navigate: (args) =>
      browser.navigate(parseInput(browserTabNavigateRequestSchema, args, "browser_tab_navigate")),
    browser_tab_set_shared: (args) =>
      browser.setShared(
        parseInput(browserTabSetSharedRequestSchema, args, "browser_tab_set_shared"),
      ),
    browser_prompt_answer: (args) =>
      browser.answerPrompt(
        parseInput(browserPromptAnswerRequestSchema, args, "browser_prompt_answer"),
      ),
    browser_site_permissions_read: (args) =>
      browser.readSitePermissions(
        parseInput(browserSitePermissionsRequestSchema, args, "browser_site_permissions_read"),
      ),
    browser_site_permissions_reset: (args) =>
      browser.resetSitePermissions(
        parseInput(
          browserSitePermissionsResetRequestSchema,
          args,
          "browser_site_permissions_reset",
        ),
      ),
    browser_picker_set: (args) =>
      browser.setPicker(parseInput(browserPickerSetRequestSchema, args, "browser_picker_set")),
    browser_annotation_capture: (args) =>
      browser.captureAnnotation(
        parseInput(browserAnnotationCaptureRequestSchema, args, "browser_annotation_capture"),
      ),
    browser_download_reveal: (args) => {
      const ref = parseInput(browserDownloadRefSchema, args, "browser_download_reveal");
      return browser.revealDownload(ref.tabId, ref.downloadId);
    },
    browser_popup_window_show: (args) =>
      browser.showPopupWindow(
        parseInput(browserTabRefSchema, args, "browser_popup_window_show").tabId,
      ),
    browser_devtools_open: (args) =>
      browser.openDevTools(parseInput(browserTabRefSchema, args, "browser_devtools_open").tabId),
  }) satisfies HostCommandHandlerDefinitions;

/** Parses the input record of one command with its request schema. */
const parseInput = <Output>(
  schema: z.ZodType<Output>,
  args: HostCommandArgs,
  command: string,
): Output =>
  schema.parse(requireRecord(commandInputRecordSchema.safeParse(args), `${command} input`));
