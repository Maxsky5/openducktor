import {
  type BrowserAnnotationCapture,
  type BrowserAnnotationCaptureRequest,
  type BrowserDevToolsOpenResponse,
  type BrowserDownloadRef,
  type BrowserEngineState,
  type BrowserFailure,
  type BrowserPickerSetRequest,
  type BrowserPromptAnswerRequest,
  type BrowserSitePermissionsRequest,
  type BrowserSitePermissionsResetRequest,
  type BrowserSitePermissionsResponse,
  type BrowserTabFrameStateRequest,
  type BrowserTabNavigateRequest,
  type BrowserTabOpenRequest,
  type BrowserTabRef,
  type BrowserTabSetSharedRequest,
  type BrowserTabSummary,
  type BrowserTabsListResponse,
  type HostCommandArgs,
  type HostCommandName,
  browserAnnotationCaptureRequestSchema,
  browserAnnotationCaptureSchema,
  browserDevToolsOpenResponseSchema,
  browserDownloadRefSchema,
  browserEngineStateSchema,
  browserPickerSetRequestSchema,
  browserPromptAnswerRequestSchema,
  browserSitePermissionsRequestSchema,
  browserSitePermissionsResetRequestSchema,
  browserSitePermissionsResponseSchema,
  browserTabFrameStateRequestSchema,
  browserTabNavigateRequestSchema,
  browserTabOpenRequestSchema,
  browserTabRefSchema,
  browserTabSetSharedRequestSchema,
  browserTabSummarySchema,
  browserTabsListResponseSchema,
} from "@openducktor/contracts";
import type { z } from "zod";
import { HostInvokeError, type InvokeFn, voidResultSchema } from "./invoke-utils";

export class HostBrowserClientError extends Error {
  readonly code: BrowserFailure["code"];
  readonly failure: BrowserFailure;
  override readonly cause: unknown;

  constructor(failure: BrowserFailure, cause: unknown) {
    super(failure.message);
    this.name = "HostBrowserClientError";
    this.code = failure.code;
    this.failure = failure;
    this.cause = cause;
  }
}

/** Host commands of browser tabs. A typed browser failure becomes `HostBrowserClientError`. */
export class HostBrowserClient {
  constructor(private readonly invokeFn: InvokeFn) {}

  private async invoke<Response>(
    command: HostCommandName,
    request: HostCommandArgs,
    schema: z.ZodType<Response>,
  ): Promise<Response> {
    try {
      return await this.invokeFn(command, request, schema);
    } catch (cause) {
      if (cause instanceof HostInvokeError && cause.failure?.kind === "browser") {
        throw new HostBrowserClientError(cause.failure.browserFailure, cause);
      }
      throw cause;
    }
  }

  async browserStateRead(): Promise<BrowserEngineState> {
    return this.invoke("browser_state_read", undefined, browserEngineStateSchema);
  }

  async browserTabsList(): Promise<BrowserTabsListResponse> {
    return this.invoke("browser_tabs_list", undefined, browserTabsListResponseSchema);
  }

  async browserTabOpen(input: BrowserTabOpenRequest): Promise<BrowserTabSummary> {
    return this.invoke(
      "browser_tab_open",
      browserTabOpenRequestSchema.parse(input),
      browserTabSummarySchema,
    );
  }

  /** Gives a saved tab its page. A tab that started stays as it is. */
  async browserTabStart(input: BrowserTabRef): Promise<BrowserTabSummary> {
    return this.invoke(
      "browser_tab_start",
      browserTabRefSchema.parse(input),
      browserTabSummarySchema,
    );
  }

  /** Reports the page state of a tab that this client shows in a frame. */
  async browserTabFrameState(input: BrowserTabFrameStateRequest): Promise<void> {
    return this.invoke(
      "browser_tab_frame_state",
      browserTabFrameStateRequestSchema.parse(input),
      voidResultSchema,
    );
  }

  async browserTabClose(input: BrowserTabRef): Promise<void> {
    return this.invoke("browser_tab_close", browserTabRefSchema.parse(input), voidResultSchema);
  }

  async browserTabNavigate(input: BrowserTabNavigateRequest): Promise<void> {
    return this.invoke(
      "browser_tab_navigate",
      browserTabNavigateRequestSchema.parse(input),
      voidResultSchema,
    );
  }

  async browserTabSetShared(input: BrowserTabSetSharedRequest): Promise<BrowserTabSummary> {
    return this.invoke(
      "browser_tab_set_shared",
      browserTabSetSharedRequestSchema.parse(input),
      browserTabSummarySchema,
    );
  }

  async browserPromptAnswer(input: BrowserPromptAnswerRequest): Promise<void> {
    return this.invoke(
      "browser_prompt_answer",
      browserPromptAnswerRequestSchema.parse(input),
      voidResultSchema,
    );
  }

  async browserSitePermissionsRead(
    input: BrowserSitePermissionsRequest,
  ): Promise<BrowserSitePermissionsResponse> {
    return this.invoke(
      "browser_site_permissions_read",
      browserSitePermissionsRequestSchema.parse(input),
      browserSitePermissionsResponseSchema,
    );
  }

  async browserSitePermissionsReset(input: BrowserSitePermissionsResetRequest): Promise<void> {
    return this.invoke(
      "browser_site_permissions_reset",
      browserSitePermissionsResetRequestSchema.parse(input),
      voidResultSchema,
    );
  }

  async browserPickerSet(input: BrowserPickerSetRequest): Promise<void> {
    return this.invoke(
      "browser_picker_set",
      browserPickerSetRequestSchema.parse(input),
      voidResultSchema,
    );
  }

  async browserAnnotationCapture(
    input: BrowserAnnotationCaptureRequest,
  ): Promise<BrowserAnnotationCapture> {
    return this.invoke(
      "browser_annotation_capture",
      browserAnnotationCaptureRequestSchema.parse(input),
      browserAnnotationCaptureSchema,
    );
  }

  async browserDownloadReveal(input: BrowserDownloadRef): Promise<void> {
    return this.invoke(
      "browser_download_reveal",
      browserDownloadRefSchema.parse(input),
      voidResultSchema,
    );
  }

  async browserPopupWindowShow(input: BrowserTabRef): Promise<void> {
    return this.invoke(
      "browser_popup_window_show",
      browserTabRefSchema.parse(input),
      voidResultSchema,
    );
  }

  async browserDevToolsOpen(input: BrowserTabRef): Promise<BrowserDevToolsOpenResponse> {
    return this.invoke(
      "browser_devtools_open",
      browserTabRefSchema.parse(input),
      browserDevToolsOpenResponseSchema,
    );
  }
}
