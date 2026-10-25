import { type ReactElement, useState } from "react";
import { Platform, TextInput, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";

/**
 * The bottom field of a new or edited Inline Diff Comment, in the style of a message field. The
 * parent keeps it above the keyboard. Editing a draft needs no host connection, because comments
 * stay on the device until the next message.
 */
export function CommentComposer({
  title,
  initialText,
  placeholder,
  saveLabel,
  editing,
  onSave,
  onCancel,
}: {
  /** What the comment covers, such as "Comment on line 4, new lines". */
  title: string;
  initialText: string;
  placeholder: string;
  saveLabel: string;
  /** True for an edit of a saved comment: the save control shows a check mark. */
  editing: boolean;
  onSave: (text: string) => void;
  onCancel: () => void;
}): ReactElement {
  const theme = useAppTheme();
  const [text, setText] = useState(initialText);
  const canSave = text.trim().length > 0;
  styles.useVariants({ canSave });
  return (
    <View style={styles.bar}>
      <View style={styles.context}>
        <Text
          variant="footnote"
          tone="secondary"
          numberOfLines={1}
          style={styles.title}
          accessibilityRole="header"
        >
          {title}
        </Text>
        <Touchable
          feedback="opacity"
          onPress={onCancel}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Cancel the comment"
        >
          <Text variant="footnote" weight="semibold" tone="tint">
            Cancel
          </Text>
        </Touchable>
      </View>
      <View style={styles.field}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.tertiaryLabel}
          selectionColor={theme.colors.selection}
          selectionHandleColor={theme.colors.tint}
          cursorColor={theme.colors.tint}
          multiline
          autoFocus
          accessibilityLabel={title}
          style={styles.input}
        />
        <Touchable
          feedback="scale"
          onPress={() => onSave(text)}
          disabled={!canSave}
          radius={16}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={saveLabel}
          accessibilityState={{ disabled: !canSave }}
          style={styles.send}
        >
          <Icon
            name={editing ? "check" : "send-up"}
            size={17}
            color={canSave ? "onTint" : "tertiaryLabel"}
          />
        </Touchable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    gap: theme.space.xs,
    paddingHorizontal: theme.space.md,
    paddingTop: theme.space.sm,
    paddingBottom: theme.space.sm,
    borderTopWidth: theme.hairline,
    borderTopColor: theme.colors.separator,
    backgroundColor: theme.colors.background,
  },
  context: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    paddingHorizontal: theme.space.xs,
  },
  title: { flex: 1 },
  field: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.space.sm,
    paddingLeft: theme.space.md,
    paddingRight: theme.space.xs,
    paddingVertical: theme.space.xs,
    borderRadius: 20,
    borderCurve: "continuous",
    backgroundColor: theme.colors.fill,
  },
  input: {
    ...theme.type.body,
    flex: 1,
    minHeight: 32,
    maxHeight: 132,
    paddingTop: Platform.select({ ios: 6, default: 4 }),
    paddingBottom: Platform.select({ ios: 6, default: 4 }),
    color: theme.colors.label,
    textAlignVertical: "top",
  },
  send: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    variants: {
      canSave: {
        true: { backgroundColor: theme.colors.tintFill },
        false: { backgroundColor: theme.colors.fillStrong },
      },
    },
  },
}));
