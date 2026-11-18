import { describe, expect, test } from "bun:test";
import * as lucide from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { COMPOSER_PLACEHOLDERS } from "./replicas/mobile/MobileComposer";
import { ADDRESS_HINT, SCAN_CARD } from "./replicas/mobile/HostForm";
import { CARD_LAYOUT } from "./replicas/mobile/pending-question";
import { answeredStatus, QUESTION_ICONS, QUESTION_TEXT } from "./replicas/mobile/QuestionCard";
import { REQUEST_LABELS } from "./replicas/mobile/RequestCard";
import { SCAN_HINT } from "./replicas/mobile/ScanScreen";
import { APP_VERSION_LABEL, SETUP_TEXT } from "./replicas/mobile/SetupScreen";
import { TAB_BAR_EDGE } from "./replicas/mobile/TabBar";
import { switchStatus } from "./replicas/settings/RemoteControl";
import {
  PAIRING_CODE_LIFETIME_MS,
  REMOTE_HTTP_WARNING,
} from "./replicas/settings/remote-control-text";
import { navGroupViews } from "./replicas/shell/nav";
import { PHONE_SESSIONS } from "./sample/mobile";
import { REQUEST } from "./scenes/mobile-needs-you/sample";
import * as question from "./scenes/mobile-question/sample";
import { importProduct, readProduct } from "./test-support/product-source";

type Outcome = "approve_once" | "approve_turn" | "approve_session" | "approve_always" | "reject";
type QuestionRequest = { requestId: string; questions: readonly (typeof question.QUESTION)[] };
type DraftEntry = { selectedOptionValues: string[]; freeText: string; useFreeText: boolean };
type FlowAction = { kind: string; label: string; enabled?: boolean };

// SAFETY: session-navigation-entry-labels.ts exports these labels, and a missing export fails the
// test.
const { SESSION_GROUP_LABELS, ATTENTION_REASON_LABELS } = await importProduct<{
  SESSION_GROUP_LABELS: Record<string, string>;
  ATTENTION_REASON_LABELS: Record<string, string>;
}>("packages/frontend-core/src/sessions/navigation/session-navigation-entry-labels.ts");
// SAFETY: pending-input-labels.ts exports these labels.
const { PENDING_INPUT_LABELS, questionAnsweredStatus } = await importProduct<{
  PENDING_INPUT_LABELS: Record<string, string>;
  questionAnsweredStatus: (answered: number, questions: number) => string;
}>("packages/frontend-core/src/sessions/pending-input/pending-input-labels.ts");
// SAFETY: agent-session-question-draft.ts exports these functions.
const drafts = await importProduct<{
  createAgentQuestionDraft: (request: QuestionRequest) => DraftEntry[];
  toggleAgentQuestionOption: (
    asked: typeof question.QUESTION,
    entry: DraftEntry | undefined,
    value: string,
  ) => DraftEntry;
  isAgentQuestionRequestComplete: (request: QuestionRequest, draft: DraftEntry[]) => boolean;
  agentQuestionTitle: (asked: typeof question.QUESTION, index: number) => string;
  agentQuestionCompletionText: (isComplete: boolean) => string;
}>("packages/frontend-core/src/sessions/pending-input/agent-session-question-draft.ts");
// SAFETY: these modules of the mobile app import no React Native code.
const { buildQuestionFlowView } = await importProduct<{
  buildQuestionFlowView: (input: {
    request: QuestionRequest;
    draft: DraftEntry[];
    activeTabId: string;
    isComplete: boolean;
  }) => { steps: unknown[]; progressLabel: string | null; action: FlowAction };
}>("apps/mobile/src/features/session/pending-input/question-flow.ts");
const { optionIcon } = await importProduct<{
  optionIcon: (multiple: boolean, selected: boolean) => string;
}>("apps/mobile/src/features/session/pending-input/question-option-icon.ts");
const { ICONS } = await importProduct<{ ICONS: Record<string, string> }>(
  "apps/mobile/src/ui/icon-names.ts",
);
// SAFETY: agent-session-approval-card-model.ts exports these functions.
const approvals = await importProduct<{
  approvalOutcomeLabel: (outcome: Outcome, request: { persistentGrant?: undefined }) => string;
  approvalOutcomeEmphasis: (outcome: Outcome) => "primary" | "secondary" | "destructive";
  approvalRequestDescription: (request: { title: string }) => string | undefined;
}>("packages/frontend-core/src/sessions/pending-input/agent-session-approval-card-model.ts");
// SAFETY: the contracts export these values.
const contracts = await importProduct<{
  REMOTE_HTTP_WARNING: string;
  REMOTE_PAIRING_CODE_LIFETIME_MS: number;
}>("packages/contracts/src/index.ts");
// SAFETY: remote-control-status.ts exports this function.
const { remoteControlSwitchDescription } = await importProduct<{
  remoteControlSwitchDescription: (
    state: { status: "available"; connectedClients: number },
    pending: boolean,
  ) => string;
}>("packages/frontend/src/components/features/remote-control/remote-control-status.ts");
// SAFETY: these modules of the mobile app import no React Native code.
const { tabBarEdgePath } = await importProduct<{ tabBarEdgePath: (width: number) => string }>(
  "apps/mobile/src/navigation/tab-bar/tab-bar-geometry.ts",
);
// SAFETY: permission-reply-options.ts exports this function.
const { approvalMutationLabel } = await importProduct<{
  approvalMutationLabel: (mutation: "unknown") => string | null;
}>("apps/mobile/src/features/session/pending-input/permission-reply-options.ts");
// SAFETY: needs-you.ts exports this function.
const { needsYouBadgeText } = await importProduct<{ needsYouBadgeText: (count: number) => string }>(
  "apps/mobile/src/navigation/tab-bar/needs-you.ts",
);
// SAFETY: app.config.ts exports the Expo config of the app as its default export.
const { default: appConfig } = await importProduct<{
  default: { version: string; ios: { buildNumber: string } };
}>("apps/mobile/app.config.ts");

// The setup screens have their words in their markup, so the test reads the product source as
// text.
const setupSource = (
  await Promise.all(
    [
      "apps/mobile/src/app/(setup)/index.tsx",
      "apps/mobile/src/hosts/add-host-form.tsx",
      "apps/mobile/src/hosts/scan-host-screen.tsx",
    ].map(readProduct),
  )
).join("\n");

const VARIANTS = { primary: "default", secondary: "outline", destructive: "destructive" };

/** The lucide-react name of the Lucide icon `name`, such as CircleCheck for circle-check. */
const componentName = (name: string | undefined): string =>
  (name ?? "")
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");

/** The names that lucide-react exports `Icon` under, such as CircleHelp and CircleQuestionMark. */
const exportNames = (Icon: LucideIcon): string[] =>
  Object.entries(lucide).flatMap(([name, value]) => (value === Icon ? [name] : []));

describe("the mobile app copied in the replicas", () => {
  test("the Sessions tab shows the group and attention labels of the app", () => {
    for (const sessions of [PHONE_SESSIONS, question.START_SESSIONS]) {
      for (const view of navGroupViews(sessions)) {
        expect(view.label).toBe(SESSION_GROUP_LABELS[view.group] ?? "");
      }
      const needsYou = navGroupViews(sessions).find((view) => view.group === "needs_you");
      expect(needsYouBadgeText(needsYou?.count ?? 0)).toBe("1");
      for (const entry of needsYou?.entries ?? []) {
        expect(Object.values(ATTENTION_REASON_LABELS)).toContain(entry.attention ?? "");
      }
    }
  });

  test("the tab bar has the cradle of the app at the width of the phone", () => {
    expect(TAB_BAR_EDGE).toBe(tabBarEdgePath(411));
  });

  test("the request cards show the labels of the app", () => {
    for (const [key, label] of Object.entries(REQUEST_LABELS)) {
      expect(PENDING_INPUT_LABELS[key]).toBe(label);
    }
  });

  test("the permission card shows the replies of the app in its order and looks", () => {
    expect(approvals.approvalRequestDescription(REQUEST)).toBe(REQUEST.title);
    expect(REQUEST.mutation).toBe(approvalMutationLabel("unknown") ?? "");
    for (const reply of REQUEST.replies) {
      // SAFETY: the sample uses only the outcomes of the contracts.
      const outcome = reply.outcome as Outcome;
      expect(approvals.approvalOutcomeLabel(outcome, {})).toBe(reply.label);
      expect(VARIANTS[approvals.approvalOutcomeEmphasis(outcome)]).toBe(reply.variant);
    }
  });

  test("the question card follows the draft and the flow of one question in the app", () => {
    const request: QuestionRequest = { requestId: "pin-order", questions: [question.QUESTION] };
    const draft = drafts.createAgentQuestionDraft(request);
    const open = buildQuestionFlowView({ request, draft, activeTabId: "0", isComplete: false });
    // One question has one step, so the card shows no tabs, no progress, and no summary.
    expect(open.steps).toHaveLength(1);
    expect(open.progressLabel).toBeNull();
    expect(open.action).toEqual({ kind: "submit", label: QUESTION_TEXT.submit, enabled: false });
    const chosen = [
      drafts.toggleAgentQuestionOption(question.QUESTION, draft[0], question.QUESTION.answer),
    ];
    expect(drafts.isAgentQuestionRequestComplete(request, chosen)).toBe(true);
    expect(
      buildQuestionFlowView({ request, draft: chosen, activeTabId: "0", isComplete: true }).action,
    ).toEqual({ kind: "submit", label: QUESTION_TEXT.submit, enabled: true });
    expect(drafts.agentQuestionTitle(question.QUESTION, 0)).toBe(question.QUESTION.header);
    expect(drafts.agentQuestionCompletionText(false)).toBe(QUESTION_TEXT.hint.open);
    expect(drafts.agentQuestionCompletionText(true)).toBe(QUESTION_TEXT.hint.complete);
    for (const answered of [0, 1]) {
      expect(answeredStatus(answered, 1)).toBe(questionAnsweredStatus(answered, 1));
    }
  });

  // The question card writes its button labels and its icons in its markup, so the test reads the
  // product source as text.
  test("the question card shows the words and the icons of the app", async () => {
    const markup = await readProduct(
      "apps/mobile/src/features/session/pending-input/structured-question-card.tsx",
    );
    for (const text of [
      `label="${QUESTION_TEXT.reset}"`,
      `"${QUESTION_TEXT.submitting}"`,
      `label="${QUESTION_TEXT.other}"`,
      'icon="sparkles"',
      'icon="message-square-plus"',
    ]) {
      expect(markup).toContain(text);
    }
    expect([optionIcon(false, false), optionIcon(false, true)]).toEqual(["circle", "circle-check"]);
    expect(await readProduct("apps/mobile/src/ui/loader-spinner.tsx")).toContain(
      'name="loader-circle"',
    );
    for (const [name, Icon] of Object.entries(QUESTION_ICONS)) {
      expect(exportNames(Icon)).toContain(componentName(ICONS[name]));
    }
  });

  test("the question card takes its new height in the time of the app", async () => {
    const card = await readProduct(
      "apps/mobile/src/features/session/pending-input/request-card.tsx",
    );
    expect(card).toContain(
      "LinearTransition.duration(motion.base)\n  .easing(motion.easeOutCurve)",
    );
    const tokens = await readProduct("apps/mobile/src/theme/tokens.ts");
    expect(tokens).toContain(`base: ${CARD_LAYOUT * 1_000},`);
    expect(tokens).toContain("easeOutCurve: Easing.bezier(0.23, 1, 0.32, 1)");
  });

  // The mobile composer writes its placeholder for a waiting session in its markup, so the test
  // reads the product source as text.
  test("the composer says Waiting while the request waits", async () => {
    expect(await readProduct("apps/mobile/src/features/composer/session-composer.tsx")).toContain(
      `isWaitingInput ? "${COMPOSER_PLACEHOLDERS.waiting}"`,
    );
  });

  test("Remote control shows the text and the code lifetime of the app", () => {
    expect(REMOTE_HTTP_WARNING).toBe(contracts.REMOTE_HTTP_WARNING);
    expect(PAIRING_CODE_LIFETIME_MS).toBe(contracts.REMOTE_PAIRING_CODE_LIFETIME_MS);
    for (const connected of [0, 1]) {
      expect(switchStatus(connected)).toBe(
        remoteControlSwitchDescription({ status: "available", connectedClients: connected }, false),
      );
    }
  });

  test("the setup screen shows the version label of the app", () => {
    expect(APP_VERSION_LABEL).toBe(`${appConfig.version} (${appConfig.ios.buildNumber})`);
  });

  test("the setup, the host form, and the camera show the words of the app", () => {
    for (const text of [
      ADDRESS_HINT,
      ...Object.values(SETUP_TEXT),
      ...Object.values(SCAN_CARD),
      ...Object.values(SCAN_HINT),
    ]) {
      expect(setupSource).toContain(text);
    }
  });
});
