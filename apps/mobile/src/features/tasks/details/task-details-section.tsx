import { type ResolvedTaskCard as TaskCard } from "@openducktor/workflows";
import type { PropsWithChildren, ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { StatusLabel } from "@/ui/badge";
import { Text } from "@/ui/text";
import { taskReviewVerdicts } from "../presentation/task-document-paint";
import { DetailsCard } from "./details-card";
import { taskTargetBranchPresentation } from "./task-details-model";

/** One fact of the Metadata card: the desktop uppercase label, then the value. */
function Fact({ label, children }: PropsWithChildren<{ label: string }>): ReactElement {
  return (
    <View style={styles.fact}>
      <Text variant="caption2" overline style={styles.factLabel}>
        {label}
      </Text>
      {children}
    </View>
  );
}

/** The target branch of the task, and why it does not resolve. */
function TargetBranchFact({ label, error }: { label: string; error: string | null }): ReactElement {
  return (
    <View accessible accessibilityLabel={`Target branch ${label}${error ? `. ${error}` : ""}`}>
      <Fact label="Target branch">
        <Text
          variant="monoSmall"
          numberOfLines={1}
          ellipsizeMode="middle"
          style={error ? styles.error : styles.value}
        >
          {label}
        </Text>
        {error ? (
          <Text variant="footnote" style={styles.muted}>
            {error}
          </Text>
        ) : null}
      </Fact>
    </View>
  );
}

/** The open state of a details card and its toggle. */
type CardCollapse = { collapsed: boolean; onToggle: () => void };

/**
 * The facts of a task: the target branch and declared review verdicts. The
 * pull request shows as a badge in the header.
 */
export function TaskMetadataSection({
  task,
  collapsed,
  onToggle,
}: CardCollapse & { task: TaskCard }): ReactElement {
  const verdicts = taskReviewVerdicts(task);
  const branch = taskTargetBranchPresentation(task);
  return (
    <DetailsCard title="Metadata" icon="layers" collapsed={collapsed} onToggle={onToggle}>
      <View style={styles.facts}>
        {branch ? <TargetBranchFact label={branch.label} error={branch.error} /> : null}
        {verdicts.map((verdict) => (
          <View
            key={verdict.id}
            accessible
            accessibilityLabel={`${verdict.title}: ${verdict.label}`}
          >
            <Fact label={verdict.title}>
              <StatusLabel label={verdict.label} tone={verdict.tone} />
            </Fact>
          </View>
        ))}
      </View>
    </DetailsCard>
  );
}

const styles = StyleSheet.create((theme) => ({
  facts: {
    gap: theme.space.md,
    padding: theme.space.md,
    borderRadius: theme.radius.sm,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.muted,
  },
  fact: { gap: 4 },
  factLabel: { color: theme.desktop.mutedForeground },
  value: { color: theme.desktop.foreground },
  muted: { color: theme.desktop.mutedForeground },
  error: { color: theme.desktop.destructive },
}));
