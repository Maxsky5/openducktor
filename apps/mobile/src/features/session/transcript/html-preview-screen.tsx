import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import { useSessionHtmlPreview } from "@openducktor/frontend-core/queries/session-html-previews";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { readHtmlPreviewToolCall } from "@openducktor/frontend-core/sessions/messages/html-preview-tool";
import { Stack } from "expo-router";
import { type ReactElement, useState } from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { type RawRouteParams, routeParam } from "@/navigation/route-params";
import { readRouteSessionIdentity } from "@/navigation/session-route-params";
import { CodeBlock } from "@/rich-content/code/code-block";
import { useAppTheme } from "@/theme/app-theme-context";
import { SegmentedControl } from "@/ui/fields";
import { Screen, useScreenEndSpace } from "@/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import { HtmlPreviewViewer } from "./rows/html-preview-viewer";
import { ToolPartSessionProvider } from "./rows/tool-details";
import { useHtmlPreviewSource } from "./tool-call-sources";
import { TranscriptRowsProvider } from "./transcript-rows-context";

type PreviewMode = "preview" | "source";

const MODES: readonly { value: PreviewMode; label: string }[] = [
  { value: "preview", label: "Preview" },
  { value: "source", label: "Source" },
];

/**
 * Full-screen view and source inspector for a published HTML preview. Reads the preview reference
 * from the live transcript call and loads the stored HTML document from the host.
 */
export function HtmlPreviewScreen({ params }: { params: RawRouteParams }): ReactElement {
  const session = readRouteSessionIdentity(params);
  const sessionKey = session.ok ? agentSessionIdentityKey(session.identity) : "";
  const partId = routeParam(params.partId) ?? "";
  const callId = routeParam(params.callId) ?? "";
  const title = routeParam(params.title) ?? "HTML Preview";
  const initialMode: PreviewMode = routeParam(params.mode) === "source" ? "source" : "preview";
  const [mode, setMode] = useState(initialMode);
  const { context, message } = useHtmlPreviewSource(sessionKey, partId, callId);
  const meta = message?.meta?.kind === "tool" ? message.meta : null;
  return (
    <Screen>
      <Stack.Screen options={{ title }} />
      {context && meta ? (
        <TranscriptRowsProvider value={context}>
          <ToolPartSessionProvider>
            <HtmlPreviewContent meta={meta} title={title} mode={mode} onModeChange={setMode} />
          </ToolPartSessionProvider>
        </TranscriptRowsProvider>
      ) : (
        <EmptyState
          icon="file-question"
          title="Preview Not Available"
          message="The session of this preview is closed. Open the session again, then open the preview."
        />
      )}
    </Screen>
  );
}

function HtmlPreviewContent({
  meta,
  title,
  mode,
  onModeChange,
}: {
  meta: ToolMeta;
  title: string;
  mode: PreviewMode;
  onModeChange: (mode: PreviewMode) => void;
}): ReactElement {
  const theme = useAppTheme();
  const endSpace = useScreenEndSpace(theme.space.xxxl);
  const preview = readHtmlPreviewToolCall(meta);
  const { html, loading, error, retry } = useSessionHtmlPreview(preview?.previewId ?? "");
  let body: ReactElement;
  if (html !== null) {
    const showingSource = mode === "source";
    body = (
      <View style={styles.fill}>
        <View
          style={styles.fill}
          pointerEvents={showingSource ? "none" : "auto"}
          accessibilityElementsHidden={showingSource}
          importantForAccessibility={showingSource ? "no-hide-descendants" : "auto"}
        >
          <HtmlPreviewViewer
            key={preview?.previewId ?? `${meta.partId}:${meta.callId}`}
            html={html}
            title={title}
            scroll="full"
            style={styles.fill}
          />
        </View>
        {showingSource ? (
          <ScrollView
            style={styles.sourceOverlay}
            contentContainerStyle={[styles.source, { paddingBottom: endSpace }]}
          >
            <CodeBlock code={html} language={null} showLineNumbers plain />
          </ScrollView>
        ) : null}
      </View>
    );
  } else if (loading) {
    body = <LoadingState label="Loading preview" />;
  } else {
    body = (
      <ErrorState
        title="Could Not Read the Preview"
        message={error ?? "The host did not return the stored HTML of this preview."}
        onRetry={preview ? retry : undefined}
      />
    );
  }
  return (
    <View style={styles.fill}>
      <View style={styles.modes}>
        <SegmentedControl
          label="HTML preview view"
          options={MODES}
          value={mode}
          onChange={onModeChange}
          disabled={html === null}
        />
      </View>
      {body}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  fill: { flex: 1 },
  modes: { paddingHorizontal: theme.layout.screenPadding, paddingBottom: theme.space.sm },
  sourceOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: theme.desktop.chatBackground,
  },
  source: { padding: theme.layout.screenPadding },
}));
