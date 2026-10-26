import type { ModelPickerView } from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import type { ReactElement } from "react";
import { ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { withAlpha } from "@/theme/color-alpha";
import { RuntimeIcon } from "@/ui/brand-icons";
import { haptics } from "@/ui/haptics";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import type { ModelPickerTab } from "./model-picker-rows";

function RailTab({
  tab,
  active,
  onSelect,
}: {
  tab: ModelPickerTab;
  active: boolean;
  onSelect: (view: ModelPickerView) => void;
}): ReactElement {
  styles.useVariants({ active });
  const favorites = tab.runtimeKind === null;
  return (
    <Touchable
      feedback="scale"
      radius={10}
      hitSlop={{ top: 4, bottom: 4 }}
      disabled={tab.disabledReason !== null}
      onPress={() => {
        if (active) return;
        haptics.selection();
        onSelect(tab.view);
      }}
      accessibilityRole="tab"
      accessibilityLabel={favorites ? "Favorite models" : `${tab.label} runtime`}
      accessibilityHint={tab.disabledReason ?? undefined}
      accessibilityState={{ selected: active, disabled: tab.disabledReason !== null }}
      style={[styles.tab, favorites && styles.iconTab]}
    >
      {tab.runtimeKind ? (
        <>
          <RuntimeIcon runtimeKind={tab.runtimeKind} size={18} />
          <Text
            variant="subhead"
            weight={active ? "semibold" : "medium"}
            tone={active ? "label" : "tertiary"}
            numberOfLines={1}
          >
            {tab.label}
          </Text>
        </>
      ) : (
        <Icon name="star" size={18} color={active ? "label" : "tertiaryLabel"} />
      )}
    </Touchable>
  );
}

/**
 * The runtime switch of the model picker, as the desktop rail turned into a row: a star for the
 * favorite models, then the brand mark and name of each runtime. The open view has the desktop
 * secondary fill and a ring.
 */
export function RuntimeRail({
  tabs,
  view,
  onSelect,
}: {
  tabs: readonly ModelPickerTab[];
  view: ModelPickerView;
  onSelect: (view: ModelPickerView) => void;
}): ReactElement {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      accessibilityRole="tablist"
      contentContainerStyle={styles.rail}
    >
      {/* The rail has one tab for each runtime. */}
      {/* react-doctor-disable-next-line react-doctor/rn-no-scrollview-mapped-list */}
      {tabs.map((tab) => (
        <RailTab key={tab.view} tab={tab} active={tab.view === view} onSelect={onSelect} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  rail: { gap: 6, paddingHorizontal: theme.layout.screenPadding },
  tab: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    variants: {
      active: {
        true: {
          backgroundColor: withAlpha(theme.desktop.secondary, 0.7),
          borderColor: theme.desktop.ring,
        },
        false: { backgroundColor: "transparent", borderColor: "transparent" },
      },
    },
  },
  iconTab: { width: 44, paddingHorizontal: 0, justifyContent: "center" },
}));
