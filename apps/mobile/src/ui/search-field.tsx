import type { ComponentRef, ReactElement, Ref } from "react";
import { TextInput, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { Icon } from "./icon";
import { IconButton } from "./icon-button";

/** A search field for a long list in a sheet or a screen, with a clear control. */
export function SearchField({
  ref,
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  autoFocus = false,
  editable = true,
}: {
  ref?: Ref<ComponentRef<typeof TextInput>> | undefined;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  autoFocus?: boolean | undefined;
  editable?: boolean | undefined;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <View style={styles.field}>
      <Icon name="search" size={16} color="tertiaryLabel" />
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.quaternaryLabel}
        selectionColor={theme.colors.selection}
        selectionHandleColor={theme.colors.tint}
        cursorColor={theme.colors.tint}
        accessibilityLabel={accessibilityLabel}
        autoFocus={autoFocus}
        editable={editable}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        returnKeyType="search"
        style={styles.input}
      />
      {value.length > 0 ? (
        <IconButton
          icon="x-circle-fill"
          size={18}
          color="quaternaryLabel"
          accessibilityLabel="Clear the search"
          onPress={() => onChangeText("")}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    minHeight: 42,
    paddingLeft: theme.space.md,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  input: {
    flex: 1,
    alignSelf: "stretch",
    paddingVertical: 0,
    paddingRight: theme.space.sm,
    color: theme.colors.label,
    ...theme.type.body,
  },
}));
