import { defineRule } from "@oxlint/plugins";

import type { ESTree, SourceCode } from "@oxlint/plugins";

type TypeAssertion = ESTree.TSAsExpression | ESTree.TSTypeAssertion;

const commentOwnerKinds = new Set([
  "ExpressionStatement",
  "PropertyDefinition",
  "ReturnStatement",
  "ThrowStatement",
  "VariableDeclaration",
]);

const exportedDeclarationKinds = new Set(["ExportDefaultDeclaration", "ExportNamedDeclaration"]);

function isConstAssertion(node: TypeAssertion): boolean {
  return (
    node.typeAnnotation.type === "TSTypeReference" &&
    node.typeAnnotation.typeName.type === "Identifier" &&
    node.typeAnnotation.typeName.name === "const"
  );
}

function assertionCommentOwner(node: TypeAssertion): ESTree.Node | null {
  let current: ESTree.Node = node;
  while (true) {
    if (commentOwnerKinds.has(current.type)) {
      const parent: ESTree.Node | null = current.parent;
      if (parent !== null && exportedDeclarationKinds.has(parent.type)) {
        return parent;
      }
      return current;
    }
    const parent: ESTree.Node | null = current.parent;
    if (parent === null || parent.type === "Program") return null;
    current = parent;
  }
}

function hasSafetyComment(sourceCode: SourceCode, node: ESTree.Node): boolean {
  return sourceCode.getCommentsBefore(node).some((comment) => /\bSAFETY\s*:/u.test(comment.value));
}

/** Require every non-const type assertion to state its local invariant. */
export const requireSafetyCommentForTypeAssertionRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a nearby SAFETY comment for every TypeScript type assertion except const assertions.",
    },
    messages: {
      missingSafetyComment:
        "This type assertion has no local `SAFETY:` comment. Check the asserted type at runtime or state the invariant immediately before the assertion.",
    },
  },
  createOnce(context) {
    const ownerAssertion = new WeakMap<ESTree.Node, TypeAssertion>();
    const ambiguousOwners = new WeakSet<ESTree.Node>();

    const checkAssertion = (node: TypeAssertion) => {
      if (isConstAssertion(node) || hasSafetyComment(context.sourceCode, node)) return;
      const owner = assertionCommentOwner(node);
      if (owner === null || !hasSafetyComment(context.sourceCode, owner)) {
        context.report({ node, messageId: "missingSafetyComment" });
        return;
      }

      const firstAssertion = ownerAssertion.get(owner);
      if (firstAssertion === undefined) {
        ownerAssertion.set(owner, node);
        return;
      }
      if (!ambiguousOwners.has(owner)) {
        context.report({ node: firstAssertion, messageId: "missingSafetyComment" });
        ambiguousOwners.add(owner);
      }
      context.report({ node, messageId: "missingSafetyComment" });
    };

    return {
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
    };
  },
});
