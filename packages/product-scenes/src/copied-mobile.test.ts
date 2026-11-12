import { describe, expect, test } from "bun:test";
import { COMPOSER_PLACEHOLDERS } from "./replicas/mobile/MobileComposer";
import { ADDRESS_HINT, SCAN_CARD } from "./replicas/mobile/HostForm";
import { REQUEST_LABELS } from "./replicas/mobile/RequestCard";
import { SCAN_HINT } from "./replicas/mobile/ScanScreen";
import { SETUP_TEXT } from "./replicas/mobile/SetupScreen";
import { TAB_BAR_EDGE } from "./replicas/mobile/TabBar";
import { switchStatus } from "./replicas/settings/RemoteControl";
import {
  PAIRING_CODE_LIFETIME_MS,
  REMOTE_HTTP_WARNING,
} from "./replicas/settings/remote-control-text";
import { navGroupViews } from "./replicas/shell/nav";
import { PHONE_SESSIONS } from "./sample/mobile";
import { REQUEST } from "./scenes/mobile-needs-you/sample";
import { importProduct, readProduct } from "./test-support/product-source";

type Outcome = "approve_once" | "approve_turn" | "approve_session" | "approve_always" | "reject";

// SAFETY: session-navigation-entry-labels.ts exports these labels, and a missing export fails the
// test.
const { SESSION_GROUP_LABELS, ATTENTION_REASON_LABELS } = await importProduct<{
  SESSION_GROUP_LABELS: Record<string, string>;
  ATTENTION_REASON_LABELS: Record<string, string>;
}>("packages/frontend-core/src/sessions/navigation/session-navigation-entry-labels.ts");
// SAFETY: pending-input-labels.ts exports these labels.
const { PENDING_INPUT_LABELS } = await importProduct<{
  PENDING_INPUT_LABELS: Record<string, string>;
}>("packages/frontend-core/src/sessions/pending-input/pending-input-labels.ts");
// SAFETY: agent-session-approval-card-model.ts exports these functions.
const approvals = await importProduct<{
  approvalOutcomeLabel: (outcome: Outcome, request: { persistentGrant?: undefined }) => string;
  approvalOutcomeEmphasis: (outcome: Outcome) => "primary" | "secondary" | "destructive";
  approvalRequestDescription: (request: { title: string }) => string | undefined;
}>("packages/frontend-core/src/sessions/pending-input/agent-session-approval-card-model.ts");
// SAFETY: agent-session-waiting-input.ts exports this function.
const { getAgentSessionWaitingInputPlaceholder } = await importProduct<{
  getAgentSessionWaitingInputPlaceholder: (session: {
    pendingApprovals: readonly unknown[];
    pendingQuestions: readonly unknown[];
  }) => string | null;
}>("packages/frontend-core/src/lib/agent-session-waiting-input.ts");
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

describe("the mobile app copied in the replicas", () => {
  test("the Sessions tab shows the group and attention labels of the app", () => {
    for (const view of navGroupViews(PHONE_SESSIONS)) {
      expect(view.label).toBe(SESSION_GROUP_LABELS[view.group] ?? "");
    }
    expect(Object.values(ATTENTION_REASON_LABELS)).toContain("Permission");
    const needsYou = navGroupViews(PHONE_SESSIONS).find((view) => view.group === "needs_you");
    expect(needsYouBadgeText(needsYou?.count ?? 0)).toBe("1");
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

  test("the composer asks for the reply while the request waits", () => {
    expect(
      getAgentSessionWaitingInputPlaceholder({ pendingApprovals: [{}], pendingQuestions: [] }),
    ).toBe(COMPOSER_PLACEHOLDERS.approval);
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
