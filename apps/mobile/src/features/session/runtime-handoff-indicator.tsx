import { RUNTIME_DESCRIPTORS_BY_KIND, type RuntimeKind } from "@openducktor/contracts";
import type { RuntimeHandoffDirection } from "@openducktor/frontend-core/types/agent-orchestrator";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { RuntimeIcon } from "@/ui/brand-icons";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";

const runtimeLabel = (kind: RuntimeKind, model?: string | undefined) => {
  const label = RUNTIME_DESCRIPTORS_BY_KIND[kind].label;
  return model ? `${label}, ${model}` : label;
};

function RuntimeLabel({ kind, model }: { kind: RuntimeKind; model?: string | undefined }) {
  return (
    <View style={styles.endpoint}>
      <RuntimeIcon runtimeKind={kind} size={14} />
      <Text variant="caption1" weight="medium" style={styles.name}>
        {model ?? RUNTIME_DESCRIPTORS_BY_KIND[kind].label}
      </Text>
    </View>
  );
}

export function RuntimeHandoffIndicator({
  direction,
  title,
  detail,
  sourceModel,
  destinationModel,
  live = false,
}: {
  direction: RuntimeHandoffDirection;
  title: string;
  detail: string | undefined;
  sourceModel?: string | undefined;
  destinationModel?: string | undefined;
  live?: boolean;
}) {
  return (
    <View style={styles.indicator} accessibilityLiveRegion={live ? "polite" : "none"}>
      <View style={styles.heading}>
        <Text variant="caption1" tone="secondary" weight="medium">
          {title}
        </Text>
        <View
          accessible
          accessibilityRole="text"
          accessibilityLabel={`${runtimeLabel(direction.from, sourceModel)} to ${runtimeLabel(direction.to, destinationModel)}`}
          style={styles.route}
        >
          <RuntimeLabel kind={direction.from} model={sourceModel} />
          <Icon name="arrow-right" color="secondaryLabel" size={14} />
          <RuntimeLabel kind={direction.to} model={destinationModel} />
        </View>
      </View>
      {detail ? (
        <Text variant="caption1" tone="secondary">
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  indicator: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    paddingVertical: theme.space.sm,
    gap: theme.space.xs,
  },
  heading: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.space.xs,
  },
  route: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    maxWidth: "100%",
    gap: theme.space.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.fill,
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.xs,
  },
  endpoint: { flexDirection: "row", alignItems: "center", flexShrink: 1, gap: theme.space.xs },
  name: { flexShrink: 1 },
}));
