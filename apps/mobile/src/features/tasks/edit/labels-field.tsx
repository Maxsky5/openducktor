import { normalizeTaskLabel } from "@openducktor/frontend-core/tasks/presentation/task-labels";
import { type ReactElement, useMemo, useState } from "react";
import { TextInput, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { FieldBox } from "./form-parts";
import { labelSuggestions, withLabel } from "./task-editor-model";

/**
 * The labels of a task as the desktop tag selector: label chips and a text field in one outlined
 * box. Under the box, dashed chips add the workspace labels that match the typed text, or create
 * the typed label. A tap on a label chip removes the label.
 */
export function LabelsField({
  labels,
  knownLabels,
  editable,
  onChange,
}: {
  labels: readonly string[];
  knownLabels: readonly string[];
  editable: boolean;
  onChange: (labels: string[]) => void;
}): ReactElement {
  const theme = useAppTheme();
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const suggestions = useMemo(
    () => labelSuggestions(knownLabels, labels, draft),
    [draft, knownLabels, labels],
  );
  // The label that the typed text creates, in its stored form.
  const candidate = normalizeTaskLabel(draft);
  const canCreate =
    candidate.length > 0 && ![...knownLabels, ...labels].some((label) => label === candidate);
  const showList = editable && (canCreate || suggestions.length > 0);
  const add = (label: string) => {
    onChange(withLabel(labels, label));
    setDraft("");
  };
  return (
    <View style={styles.root}>
      <FieldBox focused={focused} style={styles.box}>
        {labels.map((label) => (
          <Touchable
            key={label}
            feedback="scale"
            radius={theme.radius.pill}
            onPress={() => onChange(labels.filter((entry) => entry !== label))}
            disabled={!editable}
            hitSlop={{ top: 8, bottom: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`Remove label ${label}`}
            style={styles.chip}
          >
            <Icon name="tag" size={12} colorValue={theme.desktop.mutedForeground} />
            <Text variant="caption1" numberOfLines={1} style={styles.chipLabel}>
              {label}
            </Text>
            <Icon name="x" size={12} colorValue={theme.desktop.mutedForeground} />
          </Touchable>
        ))}
        <TextInput
          value={draft}
          onChangeText={(text) => {
            // A comma commits the label before it, as on desktop.
            if (text.endsWith(",")) {
              add(text.slice(0, -1));
              return;
            }
            setDraft(text);
          }}
          editable={editable}
          placeholder={labels.length === 0 ? "Type a label and press Enter" : "Add another label"}
          placeholderTextColor={theme.desktop.mutedForeground}
          selectionColor={theme.colors.selection}
          selectionHandleColor={theme.colors.tint}
          cursorColor={theme.colors.tint}
          accessibilityLabel="New label"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          submitBehavior="submit"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={() => add(draft)}
          style={styles.input}
        />
      </FieldBox>
      {showList ? (
        <View style={styles.suggestions} accessibilityLabel="Label suggestions">
          {canCreate ? (
            <Touchable
              feedback="scale"
              radius={theme.radius.pill}
              onPress={() => add(candidate)}
              hitSlop={{ top: 6, bottom: 6 }}
              accessibilityRole="button"
              accessibilityLabel={`Create label ${candidate}`}
              style={[styles.suggestion, styles.create]}
            >
              <Icon name="plus" size={14} colorValue={theme.desktop.primary} />
              <Text variant="footnote" weight="medium" numberOfLines={1} style={styles.createLabel}>
                {`Create "${candidate}"`}
              </Text>
            </Touchable>
          ) : null}
          {suggestions.map((label) => (
            <Touchable
              key={label}
              feedback="scale"
              radius={theme.radius.pill}
              onPress={() => add(label)}
              hitSlop={{ top: 6, bottom: 6 }}
              accessibilityRole="button"
              accessibilityLabel={`Add label ${label}`}
              style={styles.suggestion}
            >
              <Icon name="plus" size={14} colorValue={theme.desktop.mutedForeground} />
              <Text variant="footnote" weight="medium" numberOfLines={1} style={styles.chipLabel}>
                {label}
              </Text>
            </Touchable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { gap: theme.space.sm },
  box: {
    minHeight: theme.touchTarget + 12,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.space.sm,
    padding: theme.space.sm,
  },
  chip: {
    height: 28,
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.muted,
  },
  chipLabel: { flexShrink: 1, color: theme.desktop.foreground },
  input: {
    flexGrow: 1,
    minWidth: 160,
    minHeight: 36,
    paddingHorizontal: 4,
    paddingVertical: 0,
    color: theme.desktop.foreground,
    ...theme.type.body,
  },
  suggestions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
  suggestion: {
    minHeight: 30,
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.desktop.input,
    backgroundColor: theme.desktop.card,
  },
  create: { borderStyle: "solid", borderColor: theme.colors.tintBorder },
  createLabel: { flexShrink: 1, color: theme.desktop.primary },
}));
