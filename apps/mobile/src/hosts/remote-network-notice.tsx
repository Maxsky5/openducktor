import { REMOTE_HTTP_DETAILS, REMOTE_HTTP_WARNING } from "@openducktor/contracts";
import { useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { Icon } from "@/ui/icon";

export function RemoteNetworkNotice({ endpoint }: { endpoint: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!endpoint.trim().startsWith("http://")) return null;
  return (
    <View style={styles.notice}>
      <Touchable
        feedback="opacity"
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={styles.summary}
      >
        <Icon name="info" size={15} color="tertiaryLabel" />
        <Text variant="footnote" tone="tertiary" style={styles.text}>
          {REMOTE_HTTP_WARNING}
        </Text>
        <Icon name={expanded ? "chevron-up" : "chevron-down"} size={14} color="tertiaryLabel" />
      </Touchable>
      {expanded ? (
        <Text variant="footnote" tone="tertiary" selectable>
          {REMOTE_HTTP_DETAILS}
        </Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  notice: { gap: theme.space.sm },
  summary: { flexDirection: "row", alignItems: "center", gap: theme.space.sm, minHeight: 44 },
  text: { flex: 1 },
}));
