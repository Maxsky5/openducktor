import type { AgentModelAttachmentSupport } from "@openducktor/core";
import { formatTokenCompact } from "@openducktor/frontend-core/lib/format-token-count";
import {
  MODEL_PICKER_CAPABILITIES,
  modelPickerMetadataDescription,
} from "@openducktor/frontend-core/sessions/model-selection/model-picker-presentation";
import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { RuntimeIcon } from "@/ui/brand-icons";
import { haptics } from "@/ui/haptics";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { FavoriteStar } from "./favorite-star";
import type { ModelPickerHeaderRow, ModelPickerModelRow } from "./model-picker-rows";

/** The desktop icon of each attachment kind that a model accepts. */
const CAPABILITY_ICONS = {
  image: "image",
  video: "film",
  audio: "file-audio-2",
  pdf: "file-text",
} as const;

function CapabilityIcons({
  support,
}: {
  support: AgentModelAttachmentSupport | undefined;
}): ReactElement | null {
  if (!support) return null;
  const capabilities = MODEL_PICKER_CAPABILITIES.filter((capability) => support[capability.key]);
  if (capabilities.length === 0) return null;
  return (
    <View style={styles.capabilities}>
      {capabilities.map((capability) => (
        <Icon
          key={capability.key}
          name={CAPABILITY_ICONS[capability.key]}
          size={14}
          color="tertiaryLabel"
        />
      ))}
    </View>
  );
}

/**
 * One model of the picker, as the desktop model row: the runtime brand mark, the model name with
 * its provider and ID, the attachment kinds and the context window, and a star that adds or
 * removes the favorite. The selected model has the desktop accent fill and a violet bar at its
 * leading edge.
 */
export const ModelRow = memo(function ModelRow({
  row,
  disabled,
  favoriteDisabledReason,
  onSelect,
  onToggleFavorite,
}: {
  row: ModelPickerModelRow;
  disabled: boolean;
  /** Why the star cannot change now, or null when it can. */
  favoriteDisabledReason: string | null;
  onSelect: (key: string) => void;
  onToggleFavorite: (key: string) => void;
}): ReactElement {
  const { item, selected, detail } = row;
  const contextWindow = formatTokenCompact(item.model.contextWindow);
  const favorite = item.isFavorite ? ", favorite" : "";
  return (
    <View style={[styles.row, selected && styles.selectedRow]}>
      {selected ? <View style={styles.bar} /> : null}
      <Touchable
        feedback="highlight"
        onPress={() => {
          haptics.selection();
          onSelect(row.key);
        }}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${item.model.modelName}, ${detail}${favorite}`}
        accessibilityHint={modelPickerMetadataDescription(item) ?? undefined}
        accessibilityState={{ selected, disabled }}
        containerStyle={styles.choiceArea}
        style={styles.choice}
      >
        <RuntimeIcon runtimeKind={item.runtime.kind} size={18} />
        <View style={styles.body}>
          <Text variant="body" weight={selected ? "semibold" : "medium"} numberOfLines={1}>
            {item.model.modelName}
          </Text>
          <Text variant="footnote" tone="tertiary" numberOfLines={1} ellipsizeMode="middle">
            {detail}
          </Text>
        </View>
        <CapabilityIcons support={item.model.attachmentSupport} />
        {contextWindow ? (
          <Text variant="footnote" tone="tertiary" tabular numberOfLines={1}>
            {contextWindow}
          </Text>
        ) : null}
      </Touchable>
      <Touchable
        feedback="opacity"
        onPress={() => {
          haptics.selection();
          onToggleFavorite(row.key);
        }}
        disabled={favoriteDisabledReason !== null}
        accessibilityRole="button"
        accessibilityLabel={
          item.isFavorite
            ? `Remove ${item.model.modelName} from favorites`
            : `Add ${item.model.modelName} to favorites`
        }
        accessibilityHint={favoriteDisabledReason ?? undefined}
        style={styles.star}
      >
        <FavoriteStar filled={item.isFavorite} />
      </Touchable>
    </View>
  );
});

/** The label of a group of models: a provider, a runtime of Favorites, or the favorites. */
export const ModelGroupHeader = memo(function ModelGroupHeader({
  row,
}: {
  row: ModelPickerHeaderRow;
}): ReactElement {
  return (
    <View style={styles.header} accessibilityRole="header">
      {row.runtimeKind ? <RuntimeIcon runtimeKind={row.runtimeKind} size={14} /> : null}
      {row.favorites ? <FavoriteStar size={13} /> : null}
      <Text variant="caption2" tone="tertiary" overline numberOfLines={1} style={styles.title}>
        {row.title}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  row: { minHeight: 60, flexDirection: "row", alignItems: "stretch" },
  choiceArea: { flex: 1 },
  choice: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    paddingLeft: theme.layout.screenPadding,
    paddingVertical: 10,
  },
  // The star keeps a 44-point touch area at the end of the row.
  star: {
    width: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingRight: 4,
  },
  selectedRow: { backgroundColor: theme.desktop.accent },
  bar: {
    position: "absolute",
    left: 0,
    top: "50%",
    marginTop: -12,
    width: 4,
    height: 24,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
    backgroundColor: theme.desktop.primary,
  },
  body: { flex: 1, minWidth: 0, gap: 1 },
  capabilities: { flexDirection: "row", alignItems: "center", gap: 4 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: theme.space.lg,
    paddingBottom: 6,
  },
  title: { flexShrink: 1 },
}));
