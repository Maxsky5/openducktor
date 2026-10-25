import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import {
  approvalRequestDescription,
  approvalToolInputText,
} from "@openducktor/frontend-core/sessions/pending-input/agent-session-approval-card-model";
import { PENDING_INPUT_LABELS } from "@openducktor/frontend-core/sessions/pending-input/pending-input-labels";
import { buildContentEntries } from "@openducktor/frontend-core/sessions/transcript/agent-chat-content-keys";
import type { AgentApprovalRequest } from "@openducktor/frontend-core/types/agent-orchestrator";
import { type ComponentRef, memo, type ReactElement, type Ref, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { CommandFailure } from "@/host-session/command-outcome";
import { monoWeight, sansWeight } from "@/theme/tokens";
import { haptics } from "@/ui/haptics";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { SessionButton } from "../session-button";
import {
  approvalMutationLabel,
  buildPermissionReplyOptions,
  type PermissionReplyOption,
} from "./permission-reply-options";
import { RequestCard } from "./request-card";
import { RequestFailureBox, RequestFeedbackBox, RequestStatusLine } from "./request-feedback";

const SHOWN_PATHS = 6;
const TOOL_INPUT_LINES = 12;
/** Up to this many replies share one row; more replies stack at the full width. */
const REPLIES_IN_A_ROW = 2;

export type PermissionPromptCardProps = {
  request: AgentApprovalRequest;
  runtimeSupportedReplyOutcomes: readonly RuntimeApprovalReplyOutcome[] | null;
  /** True while the session cannot take a reply. `blockedReason` says why. */
  disabled: boolean;
  blockedReason: string | null;
  isSubmitting: boolean;
  failure: CommandFailure | null;
  onReply: (requestId: string, outcome: RuntimeApprovalReplyOutcome) => void;
  cardRef?: Ref<ComponentRef<typeof View>> | undefined;
};

/**
 * A Permission Prompt, as the desktop `AgentSessionApprovalCard`: an amber card with the request
 * details and the replies that the runtime offers, in request order.
 */
export const PermissionPromptCard = memo(function PermissionPromptCard({
  request,
  runtimeSupportedReplyOutcomes,
  disabled,
  blockedReason,
  isSubmitting,
  failure,
  onReply,
  cardRef,
}: PermissionPromptCardProps): ReactElement {
  const { options, warning } = buildPermissionReplyOptions(request, runtimeSupportedReplyOutcomes);
  const inRow = options.length <= REPLIES_IN_A_ROW;
  const reply = (option: PermissionReplyOption): void => {
    haptics.light();
    onReply(request.requestId, option.outcome);
  };
  const feedback =
    warning || failure || isSubmitting || (disabled && blockedReason) ? (
      <>
        {warning ? <RequestFeedbackBox tone="warning" message={warning} /> : null}
        {failure ? <RequestFailureBox failure={failure} /> : null}
        {isSubmitting ? <RequestStatusLine text={PENDING_INPUT_LABELS.submittingApproval} /> : null}
        {disabled && blockedReason && !isSubmitting ? (
          <RequestStatusLine text={blockedReason} />
        ) : null}
      </>
    ) : null;
  return (
    <RequestCard
      kind="permission"
      description={approvalRequestDescription(request)}
      isSubagent={request.source?.kind === "subagent"}
      status={PENDING_INPUT_LABELS.permissionStatus}
      feedback={feedback}
      cardRef={cardRef}
    >
      <ApprovalDetails request={request} />
      {options.length > 0 ? (
        <View style={inRow ? styles.repliesRow : styles.repliesColumn}>
          {options.map((option) => (
            <SessionButton
              key={option.outcome}
              label={option.label}
              variant={option.variant}
              command
              fill={inRow}
              disabled={disabled || isSubmitting}
              accessibilityHint={disabled ? (blockedReason ?? undefined) : undefined}
              onPress={() => reply(option)}
            />
          ))}
        </View>
      ) : null}
    </RequestCard>
  );
});

/** The desktop `ApprovalDetails`: short `text-xs` lines, with paths and tool input in boxes. */
function ApprovalDetails({ request }: { request: AgentApprovalRequest }): ReactElement {
  const mutation = approvalMutationLabel(request.mutation);
  const toolInput = approvalToolInputText(request);
  const paths = request.affectedPaths ?? [];
  const { action, tool } = request;
  return (
    <View style={styles.details}>
      <ApprovalGrant request={request} />
      {request.title ? (
        <Text selectable style={styles.title}>
          {request.title}
        </Text>
      ) : null}
      {mutation ? <Text style={[styles.line, styles.muted]}>{mutation}</Text> : null}
      {request.summary ? (
        <Text selectable style={styles.line}>
          {request.summary}
        </Text>
      ) : null}
      {request.details ? (
        <Text selectable style={[styles.line, styles.muted]}>
          {request.details}
        </Text>
      ) : null}
      {paths.length > 0 ? <AffectedPaths paths={paths} /> : null}
      {request.command ? <ApprovalCommand command={request.command} /> : null}
      {action ? (
        <Text selectable style={styles.line}>
          {action.description
            ? `Action: ${action.name}: ${action.description}`
            : `Action: ${action.name}`}
        </Text>
      ) : null}
      {tool ? (
        <Text selectable style={styles.line}>{`Tool: ${tool.title ?? tool.name}`}</Text>
      ) : null}
      {toolInput ? <ToolInput text={toolInput} /> : null}
    </View>
  );
}

/** What Allow for Project saves, and that Reject cancels every pending approval. */
function ApprovalGrant({ request }: { request: AgentApprovalRequest }): ReactElement {
  const grant = request.persistentGrant;
  const grantRules = buildContentEntries(grant?.rules ?? [], (rule) =>
    JSON.stringify([rule.action, rule.resource]),
  );
  return (
    <>
      {grant ? (
        <Text selectable style={styles.line}>
          {"Allow for project saves this grant for future sessions in "}
          <Text style={styles.code}>{grant.projectDirectory}</Text>.
        </Text>
      ) : null}
      {request.rejectsAllPendingApprovals ? (
        <Text style={styles.line}>Reject cancels all pending approvals in this conversation.</Text>
      ) : null}
      {grantRules.map(({ value: rule, key }) => (
        <Text key={key} selectable style={[styles.line, styles.muted, styles.code]}>
          {`${rule.action}: ${rule.resource}`}
        </Text>
      ))}
    </>
  );
}

/** The command of a command approval and its working directory. */
function ApprovalCommand({
  command,
}: {
  command: NonNullable<AgentApprovalRequest["command"]>;
}): ReactElement {
  return (
    <View>
      <Text selectable style={styles.line}>{`Command: ${command.command}`}</Text>
      {command.workingDirectory ? (
        <Text
          selectable
          numberOfLines={1}
          ellipsizeMode="middle"
          style={[styles.line, styles.muted]}
        >
          {`In ${command.workingDirectory}`}
        </Text>
      ) : null}
    </View>
  );
}

function AffectedPaths({ paths }: { paths: readonly string[] }): ReactElement {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? paths : paths.slice(0, SHOWN_PATHS);
  const hidden = paths.length - shown.length;
  return (
    <View style={styles.field}>
      <Text style={styles.line}>Affected paths:</Text>
      <View style={styles.box}>
        {shown.map((path) => (
          <View key={path} style={styles.pathChip}>
            <Text selectable numberOfLines={1} ellipsizeMode="middle" style={styles.code}>
              {path}
            </Text>
          </View>
        ))}
      </View>
      {hidden > 0 ? (
        <MoreToggle label={`Show ${hidden} more`} onPress={() => setShowAll(true)} />
      ) : null}
    </View>
  );
}

function ToolInput({ text }: { text: string }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const long = text.split("\n").length > TOOL_INPUT_LINES;
  return (
    <View style={styles.field}>
      <Text style={styles.line}>Tool input:</Text>
      <View style={styles.box}>
        <Text
          selectable
          numberOfLines={expanded || !long ? undefined : TOOL_INPUT_LINES}
          style={styles.pre}
        >
          {text}
        </Text>
      </View>
      {long ? (
        <MoreToggle
          label={expanded ? "Show less" : "Show all input"}
          onPress={() => setExpanded((current) => !current)}
        />
      ) : null}
    </View>
  );
}

function MoreToggle({ label, onPress }: { label: string; onPress: () => void }): ReactElement {
  return (
    <Touchable
      feedback="opacity"
      hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      containerStyle={styles.more}
    >
      <Text style={[styles.line, styles.moreText]}>{label}</Text>
    </Touchable>
  );
}

const styles = StyleSheet.create((theme) => ({
  details: { gap: theme.space.xs },
  field: { gap: theme.space.xs },
  line: { ...theme.type.footnote, color: theme.desktop.foreground },
  muted: { color: theme.desktop.mutedForeground },
  title: {
    ...theme.type.callout,
    ...sansWeight("medium"),
    color: theme.desktop.foreground,
  },
  code: { ...monoWeight("regular"), fontSize: 11.5, color: theme.desktop.foreground },
  box: {
    gap: theme.space.xs,
    padding: theme.space.sm,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.muted,
  },
  pathChip: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.background,
  },
  pre: { ...monoWeight("regular"), fontSize: 11, lineHeight: 18, color: theme.desktop.foreground },
  more: { alignSelf: "flex-start" },
  moreText: { ...sansWeight("medium"), color: theme.colors.tint },
  repliesRow: { flexDirection: "row", gap: theme.space.sm, paddingTop: theme.space.xs },
  repliesColumn: { gap: theme.space.sm, paddingTop: theme.space.xs },
}));
