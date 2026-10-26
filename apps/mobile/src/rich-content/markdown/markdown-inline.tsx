import type { PhrasingContent } from "mdast";
import { type ReactElement, type ReactNode, useCallback } from "react";
import { Text, type TextStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { sansWeight } from "@/theme/tokens";
import { type MarkdownVariant, useMarkdownContext } from "./markdown-context";

/**
 * Inline Markdown as nested `Text`, styled as the desktop `prose` inline text. Render it inside a
 * `Text` that sets the block font and color; strong and emphasis text keep that color.
 */
export function InlineContent({ nodes }: { nodes: readonly PhrasingContent[] }): ReactElement {
  return (
    <>
      {nodes.map((node, index) => (
        // Inline nodes of a parsed block never change order, so the index is a stable key.
        // react-doctor-disable-next-line react-doctor/no-array-index-as-key
        <InlineNode key={index} node={node} />
      ))}
    </>
  );
}

/** Inline nodes that hold other inline nodes. */
type InlineParent = Extract<PhrasingContent, { children: unknown }>;

function InlineNode({ node }: { node: PhrasingContent }): ReactNode {
  const { definitions, appearance } = useMarkdownContext();
  switch (node.type) {
    case "strong":
      return (
        <Text style={styles.strong}>
          <InlineContent nodes={node.children} />
        </Text>
      );
    case "emphasis":
      return (
        <Text style={styles.emphasis}>
          <InlineContent nodes={node.children} />
        </Text>
      );
    case "delete":
      return (
        <Text style={styles.delete}>
          <InlineContent nodes={node.children} />
        </Text>
      );
    case "link":
      return (
        <InlineLink url={node.url}>
          <InlineContent nodes={node.children} />
        </InlineLink>
      );
    case "linkReference": {
      const definition = definitions.get(node.identifier);
      const children = <InlineContent nodes={node.children} />;
      return definition === undefined ? (
        children
      ) : (
        <InlineLink url={definition.url}>{children}</InlineLink>
      );
    }
    default:
      return inlineLeaf(node, appearance.variant);
  }
}

/** An inline node without inline children: text, code, math, a break, an image, or a footnote. */
const inlineLeaf = (
  node: Exclude<PhrasingContent, InlineParent>,
  variant: MarkdownVariant,
): ReactNode => {
  switch (node.type) {
    case "text":
      return node.value;
    case "inlineCode":
      // `prose-code:px-1`: nested text has no padding, so thin spaces keep the room around it.
      return <Text style={[styles.code, CODE_SIZE[variant]]}>{`\u2009${node.value}\u2009`}</Text>;
    case "break":
      return "\n";
    case "image":
    case "imageReference":
      // A paragraph shows its own images as blocks. An image inside a link or emphasis shows its alt text.
      return <Text>{`[${node.alt || "Image"}]`}</Text>;
    case "footnoteReference":
      // The desktop shows a superscript footnote link.
      return (
        <Text style={[styles.link, FOOTNOTE_SIZE[variant]]}>{node.label ?? node.identifier}</Text>
      );
    case "html":
      // Raw HTML shows as its text. It never renders as HTML.
      return node.value;
    case "inlineMath":
      // Math shows in the isolated page. Only a block that is still streaming shows math here.
      return <Text style={[styles.code, CODE_SIZE[variant]]}>{`\u2009${node.value}\u2009`}</Text>;
  }
};

function InlineLink({ url, children }: { url: string; children: ReactNode }): ReactElement {
  const { openLink } = useMarkdownContext();
  const onPress = useCallback(() => openLink(url), [openLink, url]);
  return (
    <Text accessibilityRole="link" onPress={onPress} style={styles.link}>
      {children}
    </Text>
  );
}

/**
 * Inline sizes by variant. These are static styles, because a stylesheet variant applies only in
 * the component that selects it, and inline nodes nest to any depth.
 */
const CODE_SIZE = {
  document: { fontSize: 13 },
  compact: { fontSize: 12 },
} as const satisfies Record<MarkdownVariant, TextStyle>;
const FOOTNOTE_SIZE = {
  document: { fontSize: 11 },
  compact: { fontSize: 10 },
} as const satisfies Record<MarkdownVariant, TextStyle>;

const styles = StyleSheet.create((theme) => ({
  // `prose strong`: weight 600 in the color of the text around it.
  strong: sansWeight("semibold"),
  emphasis: { fontStyle: "italic" },
  delete: { textDecorationLine: "line-through" },
  // `prose-code:text-rose-600 dark:text-rose-400 font-medium`, 12px in `document` and 11px in
  // `compact`: one step larger on the phone. It is never italic, as `[&_code]:not-italic`.
  code: {
    fontFamily: theme.fonts.mono.medium,
    fontWeight: "500",
    fontStyle: "normal",
    color: theme.scheme === "dark" ? theme.palette.rose400 : theme.palette.rose600,
  },
  // The desktop link: `text-foreground underline decoration-muted-foreground`, with the
  // `prose a` weight 500.
  link: {
    ...sansWeight("medium"),
    color: theme.desktop.foreground,
    textDecorationLine: "underline",
    textDecorationColor: theme.desktop.mutedForeground,
  },
}));
