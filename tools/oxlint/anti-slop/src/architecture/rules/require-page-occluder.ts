import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

const OCCLUDER_ATTRIBUTE = "data-page-occluder";

type Node = ESTree.Node;

const isNode = (value: unknown): value is Node =>
	value !== null && typeof value === "object" && "type" in value && typeof value.type === "string";

/** True when a JSX subtree sets `data-page-occluder` on one of its elements. */
const marksOccluder = (node: Node): boolean => {
	if (
		node.type === "JSXAttribute" &&
		node.name.type === "JSXIdentifier" &&
		node.name.name === OCCLUDER_ATTRIBUTE
	) {
		return true;
	}
	for (const [key, value] of Object.entries(node)) {
		if (key === "parent") continue;
		const children = Array.isArray(value) ? value : [value];
		if (children.some((child) => isNode(child) && marksOccluder(child))) return true;
	}
	return false;
};

const portalElementName = (name: ESTree.JSXElementName): string | null => {
	if (name.type === "JSXIdentifier") return name.name;
	if (name.type === "JSXMemberExpression") return name.property.name;
	return null;
};

/**
 * Requires `data-page-occluder` in each portal of host DOM. A native browser page draws above all
 * host DOM, so the browser layer hides the page only under the overlays that carry the mark.
 */
export const requirePageOccluderRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description: "Require `data-page-occluder` on the content of each portal.",
		},
		messages: {
			missingOccluder:
				"Mark the portal content with `data-page-occluder`. A native browser page draws above all host DOM and hides an unmarked overlay. Disable this rule with a reason only for content that is not an overlay.",
		},
	},
	createOnce(context) {
		return {
			CallExpression(node) {
				if (node.callee.type !== "Identifier" || node.callee.name !== "createPortal") return;
				const content = node.arguments[0];
				if (content === undefined || marksOccluder(content)) return;
				context.report({ node, messageId: "missingOccluder" });
			},
			JSXElement(node) {
				const name = portalElementName(node.openingElement.name);
				if (name === null || !name.endsWith("Portal") || node.children.length === 0) return;
				if (node.children.some(marksOccluder)) return;
				context.report({ node, messageId: "missingOccluder" });
			},
		};
	},
});
