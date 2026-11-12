import { remarkStructure, type StructureOptions } from "fumadocs-core/mdx-plugins/remark-structure";
import { z } from "zod";

type Transformer = ReturnType<typeof remarkStructure>;
type Root = Parameters<Transformer>[0];
type File = Parameters<Transformer>[1];
type Node = Root | Root["children"][number];

/** An accordion with an `id` links to itself. Its `id` and `title` are text in the MDX source. */
const linkedAccordion = z.object({ id: z.string().min(1), title: z.string().min(1) });

/**
 * Makes each `<Accordion>` with an `id` a search result of its own. The title and the body link to
 * `#id`, so a search opens the accordion and not the section above it. remark-structure records
 * the `data.structuredData` of a node in place of the node, so this plugin must run before it.
 * `options` are the options of the remark-structure run for the page, so the body of an accordion
 * gets the same text as the rest of the page.
 */
export function remarkAccordionSearch(options: StructureOptions) {
  const structure = remarkStructure(options);

  const visit = (node: Node, file: File): void => {
    if (node.type === "mdxJsxFlowElement" && node.name === "Accordion") {
      const attributes = Object.fromEntries(
        node.attributes.flatMap((item) =>
          item.type === "mdxJsxAttribute" ? [[item.name, item.value]] : [],
        ),
      );
      if (!("id" in attributes)) return;
      const parsed = linkedAccordion.safeParse(attributes);
      if (!parsed.success) {
        throw new Error(
          `An Accordion in ${file.path} needs a text id and a text title. ${z.prettifyError(parsed.error)}`,
        );
      }
      const { id, title } = parsed.data;
      // remark-structure writes the body of the accordion to the file. The run for the page
      // replaces it later.
      structure({ type: "root", children: node.children }, file, () => {});
      const body = file.data.structuredData!.contents;
      node.data = {
        ...node.data,
        structuredData: {
          contents: [
            { heading: id, content: title },
            ...body.map((item) => ({ ...item, heading: id })),
          ],
        },
      };
      return;
    }
    if ("children" in node) for (const child of node.children) visit(child, file);
  };

  return (tree: Root, file: File) => visit(tree, file);
}
