import type { remarkStructure } from "fumadocs-core/mdx-plugins/remark-structure";
import { replaceSource } from "fumadocs-core/mdx-plugins/stringifier";
import { z } from "zod";
import { LANE_LABELS } from "./lanes";

type Transformer = ReturnType<typeof remarkStructure>;
type Root = Parameters<Transformer>[0];
type File = Parameters<Transformer>[1];
type Node = Root | Root["children"][number];

const LABELS = new Map(Object.entries(LANE_LABELS));
/** The `of` attribute is text in the MDX source, not an expression. */
const laneId = z.string();

/**
 * Gives each `<Status of="…" />` the title of its lane in the search text, so "moves it to
 * <Status of="closed" />" reads "moves it to Done". The page still shows the lane pill.
 * remark-structure gives an element only the text inside it, and the pill has none. The plugin
 * replaces the source of the `of` attribute, which is inside the element, for the `search`
 * stringifier only. It must run before the plugins that build search text.
 */
export function remarkStatusSearch() {
  const visit = (node: Node, file: File): void => {
    if (node.type === "mdxJsxTextElement" && node.name === "Status") {
      const of = node.attributes.find(
        (attribute) => attribute.type === "mdxJsxAttribute" && attribute.name === "of",
      );
      const id = laneId.safeParse(of?.value);
      const label = id.success ? LABELS.get(id.data) : undefined;
      if (!of?.position || label === undefined) {
        throw new Error(
          `A Status in ${file.path} needs of="<lane>", with one of: ${[...LABELS.keys()].join(", ")}.`,
        );
      }
      replaceSource(file, { type: "text", value: label, position: of.position }, label, "search");
      return;
    }
    if ("children" in node) for (const child of node.children) visit(child, file);
  };

  return (tree: Root, file: File) => visit(tree, file);
}
