import type {
  BlockContent,
  Blockquote,
  DefinitionContent,
  FootnoteDefinition,
  Heading,
  List,
  ListItem,
  Nodes,
  Paragraph,
  RootContent,
  Table,
} from "mdast";
import { createContext, type ReactElement, use, useMemo } from "react";
import {
  ScrollView,
  Text,
  type TextStyle,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { sansWeight } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { CodeBlock } from "../code/code-block";
import { MARKDOWN_BODY, type MarkdownAppearance, useMarkdownContext } from "./markdown-context";
import { lastDescendant } from "./markdown-document";
import { MarkdownImage } from "./markdown-image";
import { InlineContent } from "./markdown-inline";
import {
  type ListItemMarker,
  listItemMarker,
  paragraphSegments,
  plainText,
  tableColumnWidths,
} from "./markdown-layout";

type FlowContent = BlockContent | DefinitionContent;

const FLOW_TYPES: ReadonlySet<string> = new Set<FlowContent["type"]>([
  "blockquote",
  "code",
  "definition",
  "footnoteDefinition",
  "heading",
  "html",
  "list",
  "math",
  "paragraph",
  "table",
  "thematicBreak",
]);

const isFlowContent = (node: RootContent): node is FlowContent => FLOW_TYPES.has(node.type);

/**
 * Whether a block quote holds the text, and the paragraphs that open and close the quote. The
 * desktop `prose` quote puts curly quotes before its first paragraph and after its last one.
 */
type QuoteMarks = {
  readonly quoted: boolean;
  readonly first: Paragraph | null;
  readonly last: Paragraph | null;
};

const NO_QUOTE: QuoteMarks = { quoted: false, first: null, last: null };
const QUOTED_LIST: QuoteMarks = { quoted: true, first: null, last: null };
const QuoteMarksContext = createContext<QuoteMarks>(NO_QUOTE);

/** The fence that a streaming block ends in, also one inside a list or a quote. */
const OpenFenceContext = createContext<Nodes | null>(null);

/**
 * The text styles of an appearance: the body size, then the muted color and the italic slant.
 * Blocks pick plain style entries instead of stylesheet variants: a long message renders many
 * blocks, and each variant selection computes the whole stylesheet again in native code.
 */
const textAppearance = (appearance: MarkdownAppearance) =>
  [
    appearance.variant === "compact" ? styles.compactBody : styles.documentBody,
    appearance.muted ? styles.mutedText : null,
    appearance.italic ? styles.italic : null,
  ] as const;

/**
 * A top-level block that native views draw, styled as the desktop `.markdown-body prose` text.
 * Math and Mermaid blocks use the isolated page view. The open fence of a `streaming` block shows
 * plain code, because highlighting text that grows on each update costs too much.
 */
export function NativeBlock({
  node,
  streaming,
}: {
  node: RootContent;
  streaming: boolean;
}): ReactElement | null {
  if (!isFlowContent(node)) return <PlainTextBlock text={plainText(node)} />;
  return (
    <OpenFenceContext value={streaming ? lastDescendant(node) : null}>
      <FlowBlock node={node} />
    </OpenFenceContext>
  );
}

/** One flow node. Each block component picks its own styles for the appearance. */
function FlowBlock({ node }: { node: FlowContent }): ReactElement | null {
  const { appearance } = useMarkdownContext();
  const openFence = use(OpenFenceContext);
  switch (node.type) {
    case "paragraph":
      return <ParagraphBlock node={node} />;
    case "heading":
      return <HeadingBlock node={node} />;
    case "list":
      return <ListBlock node={node} />;
    case "blockquote":
      return <QuoteBlock node={node} />;
    case "table":
      return <TableBlock node={node} />;
    case "thematicBreak":
      return <View style={styles.rule} />;
    case "code":
      return (
        <CodeBlock
          code={node.value}
          language={node.lang ?? null}
          plain={node === openFence || !appearance.highlightCode}
          variant={appearance.variant}
        />
      );
    case "math":
      // A math fence that is still streaming shows as code until it closes.
      return (
        <CodeBlock
          code={node.value}
          language="latex"
          copyable={false}
          plain
          variant={appearance.variant}
        />
      );
    case "html":
      // Raw HTML shows as its text. It never renders as HTML.
      return <PlainTextBlock text={node.value} />;
    case "definition":
      return null;
    case "footnoteDefinition":
      return <FootnoteBlock node={node} />;
  }
}

function PlainTextBlock({ text }: { text: string }): ReactElement {
  const { selectable, appearance } = useMarkdownContext();
  return (
    <Text style={[styles.paragraph, ...textAppearance(appearance)]} selectable={selectable}>
      {text}
    </Text>
  );
}

function FootnoteBlock({ node }: { node: FootnoteDefinition }): ReactElement {
  const { appearance } = useMarkdownContext();
  return (
    <View style={styles.footnote}>
      <Text style={[styles.paragraph, ...textAppearance(appearance), styles.footnoteLabel]}>
        {`${node.label ?? node.identifier}.`}
      </Text>
      <View style={styles.flow}>
        <FlowChildren nodes={node.children} />
      </View>
    </View>
  );
}

function FlowChildren({ nodes }: { nodes: readonly FlowContent[] }): ReactElement {
  return (
    <>
      {nodes.map((child, index) => (
        // Children of a parsed block never change order, so the index is a stable key.
        // react-doctor-disable-next-line react-doctor/no-array-index-as-key
        <FlowBlock key={index} node={child} />
      ))}
    </>
  );
}

function ParagraphBlock({ node }: { node: Paragraph }): ReactElement {
  const { definitions, selectable, appearance } = useMarkdownContext();
  const quote = use(QuoteMarksContext);
  const segments = useMemo(
    () => paragraphSegments(node.children, definitions),
    [definitions, node],
  );
  const open = quote.first === node ? "“" : null;
  const close = quote.last === node ? "”" : null;
  const first = segments[0];
  if (segments.length === 1 && first?.kind === "text") {
    return (
      <Text
        style={[
          styles.paragraph,
          ...textAppearance(appearance),
          quote.quoted ? styles.quoteText : null,
        ]}
        selectable={selectable}
      >
        {open}
        <InlineContent nodes={first.nodes} />
        {close}
      </Text>
    );
  }
  const lastIndex = segments.length - 1;
  return (
    <View style={styles.segments}>
      {segments.map((segment, index) =>
        // The segments of a parsed paragraph never change order, so the index is a stable key.
        segment.kind === "image" ? (
          // react-doctor-disable-next-line react-doctor/no-array-index-as-key
          <MarkdownImage key={index} url={segment.url} alt={segment.alt} />
        ) : (
          <Text
            // react-doctor-disable-next-line react-doctor/no-array-index-as-key
            key={index}
            style={[
              styles.paragraph,
              ...textAppearance(appearance),
              quote.quoted ? styles.quoteText : null,
            ]}
            selectable={selectable}
          >
            {index === 0 ? open : null}
            <InlineContent nodes={segment.nodes} />
            {index === lastIndex ? close : null}
          </Text>
        ),
      )}
    </View>
  );
}

/** The `document` heading style of each depth. Depths 5 and 6 share the smallest one. */
const HEADING_LEVELS = {
  1: "h1",
  2: "h2",
  3: "h3",
  4: "h4",
  5: "h5",
  6: "h5",
} as const satisfies Record<Heading["depth"], string>;

type HeadingLevel = (typeof HEADING_LEVELS)[Heading["depth"]] | "compactHeading";

/** A heading with the desktop `prose` size of its depth and `prose-headings:font-semibold`. */
function HeadingBlock({ node }: { node: Heading }): ReactElement {
  const { selectable, appearance } = useMarkdownContext();
  const level: HeadingLevel =
    appearance.variant === "compact" ? "compactHeading" : HEADING_LEVELS[node.depth];
  return (
    <Text
      accessibilityRole="header"
      style={[
        styles.heading,
        styles[level],
        appearance.muted ? styles.mutedText : null,
        appearance.italic ? styles.italic : null,
      ]}
      selectable={selectable}
    >
      <InlineContent nodes={node.children} />
    </Text>
  );
}

/**
 * A block quote as the desktop `prose` quote: a 4-point `border-input` bar, a `bg-muted/30` wash,
 * `px-3 py-1`, and medium italic text in curly quotes.
 */
function QuoteBlock({ node }: { node: Blockquote }): ReactElement {
  const { appearance } = useMarkdownContext();
  const marks = useMemo<QuoteMarks>(() => {
    const paragraphs = node.children.filter((child) => child.type === "paragraph");
    return { quoted: true, first: paragraphs[0] ?? null, last: paragraphs.at(-1) ?? null };
  }, [node]);
  return (
    <View
      style={[
        styles.quote,
        appearance.variant === "compact" ? styles.compactQuote : styles.documentQuote,
      ]}
    >
      <QuoteMarksContext value={marks}>
        <FlowChildren nodes={node.children} />
      </QuoteMarksContext>
    </View>
  );
}

/** The characters of an ordered list number column: its longest number and a period. */
const numberColumnCharacters = (list: List): number => {
  const start = list.start ?? 1;
  const last = start + list.children.length - 1;
  return Math.max(String(start).length, String(last).length) + 1;
};

function ListBlock({ node }: { node: List }): ReactElement {
  const { appearance } = useMarkdownContext();
  const { quoted } = use(QuoteMarksContext);
  const ordered = node.ordered === true;
  const tight = node.spread !== true;
  const start = node.start ?? 1;
  const compact = appearance.variant === "compact";
  const spacing = tight
    ? compact
      ? styles.compactList
      : styles.documentList
    : compact
      ? styles.compactLooseList
      : styles.documentLooseList;
  // Every item shares one marker column, so wrapped lines align under the item text.
  const markerColumn = styles.markerColumn(ordered ? numberColumnCharacters(node) : 0, compact);
  return (
    // A list in a quote keeps the quote text but shows no quote marks.
    <QuoteMarksContext value={quoted ? QUOTED_LIST : NO_QUOTE}>
      <View style={spacing}>
        {node.children.map((item, index) => (
          <ListItemRow
            // The items of a parsed list never change order, so the index is a stable key.
            // react-doctor-disable-next-line react-doctor/no-array-index-as-key
            key={index}
            item={item}
            marker={listItemMarker(item, ordered, start + index)}
            ordered={ordered}
            markerColumn={markerColumn}
          />
        ))}
      </View>
    </QuoteMarksContext>
  );
}

function ListItemRow({
  item,
  marker,
  ordered,
  markerColumn,
}: {
  item: ListItem;
  marker: ListItemMarker;
  ordered: boolean;
  markerColumn: ViewStyle;
}): ReactElement {
  const { appearance } = useMarkdownContext();
  const compact = appearance.variant === "compact";
  return (
    <View style={styles.listItem}>
      {marker.kind === "checkbox" ? (
        // A task item shows its checkbox in place of the bullet or the number.
        <View style={[markerColumn, styles.checkboxColumn]}>
          <TaskCheckbox checked={marker.checked} />
        </View>
      ) : (
        <Text
          style={[
            styles.listMarker,
            compact ? styles.compactBody : styles.documentBody,
            ordered ? styles.orderedMarker : styles.bulletMarker,
            appearance.italic ? styles.italic : null,
            markerColumn,
          ]}
          // A bullet only decorates. Screen readers read the number of an ordered item.
          accessibilityElementsHidden={!ordered}
          importantForAccessibility={ordered ? "auto" : "no"}
        >
          {marker.text}
        </Text>
      )}
      <View
        style={[
          styles.listItemBody,
          compact ? styles.compactListItemBody : styles.documentListItemBody,
        ]}
      >
        <FlowChildren nodes={item.children} />
      </View>
    </View>
  );
}

/**
 * A read-only task list checkbox, as the disabled checkbox of a desktop GFM task item. Screen
 * readers hear its checked state.
 */
function TaskCheckbox({ checked }: { checked: boolean }): ReactElement {
  const { appearance } = useMarkdownContext();
  return (
    <View
      accessible
      accessibilityRole="checkbox"
      accessibilityLabel={checked ? "Done" : "Not done"}
      accessibilityState={{ checked, disabled: true }}
      style={[
        styles.checkbox,
        appearance.variant === "compact" ? styles.compactCheckbox : styles.documentCheckbox,
      ]}
    >
      <Icon
        name={checked ? "checkbox-checked" : "checkbox-unchecked"}
        size={14}
        color="quaternaryLabel"
      />
    </View>
  );
}

/**
 * A table as the desktop `prose` table: no frame, a semibold header over a `gray-300` rule, and
 * `gray-200` rules between rows. It scrolls sideways on a narrow screen.
 */
function TableBlock({ node }: { node: Table }): ReactElement {
  const { selectable, appearance } = useMarkdownContext();
  const { fontScale } = useWindowDimensions();
  const compact = appearance.variant === "compact";
  const columnStyles = useMemo(
    () => tableColumnWidths(node, 7.5 * fontScale).map((width) => ({ width })),
    [fontScale, node],
  );
  const lastRow = node.children.length - 1;
  const lastColumn = columnStyles.length - 1;
  return (
    <ScrollView horizontal style={styles.tableScroll} showsHorizontalScrollIndicator={false}>
      <View>
        {node.children.map((row, rowIndex) => (
          <View
            key={rowIndex}
            style={[
              styles.tableRow,
              rowIndex === 0 && styles.tableHeaderRow,
              rowIndex === lastRow && rowIndex > 0 && styles.tableLastRow,
            ]}
          >
            {columnStyles.map((columnStyle, column) => {
              const cell = row.children[column];
              const align = node.align?.[column] ?? null;
              return (
                <View
                  key={column}
                  style={[
                    styles.tableCell,
                    rowIndex === 0 && styles.tableHeaderCell,
                    columnStyle,
                    column === 0 && styles.tableFirstCell,
                    column === lastColumn && styles.tableLastCell,
                  ]}
                >
                  <Text
                    style={[
                      styles.cellText,
                      compact ? styles.compactCellText : styles.documentCellText,
                      appearance.muted ? styles.mutedText : null,
                      appearance.italic ? styles.italic : null,
                      rowIndex === 0 && styles.headerText,
                      align !== null && ALIGN_STYLES[align],
                    ]}
                    selectable={selectable}
                  >
                    {cell === undefined ? null : <InlineContent nodes={cell.children} />}
                  </Text>
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const ALIGN_STYLES = StyleSheet.create({
  left: { textAlign: "left" },
  center: { textAlign: "center" },
  right: { textAlign: "right" },
});

/** `prose ul` padding and `li` padding: the item text starts 30 points in, 28 in `compact`. */
const MARKER_COLUMN = { document: 24, compact: 22 } as const;
const MARKER_GAP = 6;

const ITALIC = { fontStyle: "italic" } satisfies TextStyle;

/** `prose-p:my-2` in `document` and `prose-p:my-1` in `compact`. */
const PARAGRAPH_MARGIN = { document: 8, compact: 4 } as const;

const styles = StyleSheet.create((theme, rt) => ({
  flow: { flex: 1, minWidth: 0 },
  segments: { gap: 16 },
  paragraph: { ...sansWeight("regular"), color: theme.desktop.foreground },
  documentBody: MARKDOWN_BODY.document,
  compactBody: MARKDOWN_BODY.compact,
  mutedText: { color: theme.desktop.mutedForeground },
  heading: { ...sansWeight("semibold"), color: theme.desktop.foreground },
  // `prose` h1 2.25em, h2 1.5em, h3 1.25em, h4 1em of the 15-point base, and every `compact`
  // heading at `text-sm`, one step larger.
  h1: { fontSize: 34, lineHeight: 38, letterSpacing: -0.4 },
  h2: { fontSize: 22, lineHeight: 30, letterSpacing: -0.2 },
  h3: { fontSize: 19, lineHeight: 30 },
  h4: { fontSize: 15, lineHeight: 23 },
  h5: { fontSize: 15, lineHeight: 24 },
  compactHeading: { fontSize: 15, lineHeight: 24 },
  quote: {
    borderLeftWidth: 4,
    borderLeftColor: theme.desktop.input,
    backgroundColor: theme.colors.insetFill,
    paddingHorizontal: 12,
  },
  // `py-1` and the margin of the paragraphs inside.
  documentQuote: { paddingVertical: 4 + PARAGRAPH_MARGIN.document, gap: PARAGRAPH_MARGIN.document },
  compactQuote: { paddingVertical: 4 + PARAGRAPH_MARGIN.compact, gap: PARAGRAPH_MARGIN.compact },
  quoteText: { ...sansWeight("medium"), ...ITALIC },
  italic: ITALIC,
  rule: { height: 1, backgroundColor: theme.desktop.input },
  // `prose-li:my-0.5` in a tight list; the paragraph margins in a loose one.
  documentList: { gap: 2 },
  documentLooseList: { gap: PARAGRAPH_MARGIN.document },
  compactList: { gap: 0 },
  compactLooseList: { gap: PARAGRAPH_MARGIN.compact },
  listItem: { flexDirection: "row", gap: MARKER_GAP },
  listItemBody: { flex: 1, minWidth: 0 },
  // A nested list keeps the `prose-ul:my-2` margin from the item text.
  documentListItemBody: { gap: PARAGRAPH_MARGIN.document },
  compactListItemBody: { gap: PARAGRAPH_MARGIN.compact },
  listMarker: {
    ...sansWeight("regular"),
    textAlign: "right",
    paddingRight: 4,
    fontVariant: ["tabular-nums"],
  },
  // `prose` with no color modifier: gray-500 numbers and gray-300 bullets. The mobile palette has
  // slate, the closest family.
  orderedMarker: { color: theme.palette.slate500 },
  bulletMarker: { color: theme.palette.slate300 },
  // A column holds the bullet, or the longest number of an ordered list. A Space Grotesk digit is
  // about 0.6 of the font size wide.
  markerColumn: (numberCharacters: number, compact: boolean) => {
    const size = compact ? "compact" : "document";
    return {
      width: Math.max(
        MARKER_COLUMN[size],
        Math.ceil(numberCharacters * MARKDOWN_BODY[size].fontSize * 0.6 * rt.fontScale) + 4,
      ),
    };
  },
  // The checkbox sits at the end of the marker column, where a bullet or a number ends.
  checkboxColumn: { alignItems: "flex-end", paddingRight: 4 },
  checkbox: { justifyContent: "center" },
  documentCheckbox: { height: MARKDOWN_BODY.document.lineHeight },
  compactCheckbox: { height: MARKDOWN_BODY.compact.lineHeight },
  tableScroll: { flexGrow: 0 },
  // The `prose` table rules: gray-200 between rows and gray-300 under the header.
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: theme.palette.slate200,
  },
  tableHeaderRow: { borderBottomColor: theme.palette.slate300, alignItems: "flex-end" },
  tableLastRow: { borderBottomWidth: 0 },
  // `0.5714286em` cell padding; the outer cells have none on their outer side.
  tableCell: { paddingHorizontal: 8, paddingVertical: 8 },
  tableHeaderCell: { paddingTop: 0 },
  tableFirstCell: { paddingLeft: 0 },
  tableLastCell: { paddingRight: 0 },
  // The `prose` table text is 0.875em with a 1.71 line height.
  cellText: { ...sansWeight("regular"), color: theme.desktop.foreground },
  documentCellText: { fontSize: 13, lineHeight: 22 },
  compactCellText: { fontSize: 12, lineHeight: 18 },
  headerText: sansWeight("semibold"),
  footnote: { flexDirection: "row", gap: MARKER_GAP },
  footnoteLabel: { color: theme.palette.slate500, fontVariant: ["tabular-nums"] },
}));
