import { defineRule } from "@oxlint/plugins";

import {
  classifyWideningTarget,
  createTypeEnvironment,
  type TypeEnvironment,
} from "../shared/dictionary-types.ts";
import { resolveVariable, singleVariableDeclarator } from "../shared/global-reference.ts";

import type { ESTree, SourceCode } from "@oxlint/plugins";

type BroadTypeKind = "dictionary" | "object" | "top";

const functionBoundaryTypes = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
  "TSDeclareFunction",
  "TSEmptyBodyFunctionExpression",
]);

const unwrapExpression = (expression: ESTree.Expression): ESTree.Expression => {
  let current = expression;
  while (current.type === "ParenthesizedExpression") current = current.expression;
  return current;
};

const unwrapType = (type: ESTree.TSType): ESTree.TSType => {
  let current = type;
  while (current.type === "TSParenthesizedType") current = current.typeAnnotation;
  return current;
};

const broadTypeKind = (type: ESTree.TSType, environment: TypeEnvironment): BroadTypeKind | null => {
  if (unwrapType(type).type === "TSAnyKeyword") return "top";
  const target = classifyWideningTarget(type, environment);
  if (target?.kind === "unknown") return "top";
  if (target?.kind === "object") return "object";
  return target?.kind === "open dictionary" || target?.kind === "generic container"
    ? "dictionary"
    : null;
};

const functionBoundary = (node: ESTree.Node): ESTree.Node | null => {
  let current = node.parent;
  while (current !== null && current.type !== "Program") {
    if (functionBoundaryTypes.has(current.type)) return current;
    current = current.parent;
  }
  return null;
};

const preciseSourceType = (
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  environment: TypeEnvironment,
): ESTree.TSType | null => {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped.type !== "Identifier") return null;
  const variable = resolveVariable(sourceCode, unwrapped);
  const annotation = variable?.identifiers.find(
    (identifier) => identifier.typeAnnotation?.typeAnnotation !== undefined,
  )?.typeAnnotation?.typeAnnotation;
  return annotation !== undefined && broadTypeKind(annotation, environment) === null
    ? annotation
    : null;
};

const assertionFromExpression = (
  expression: ESTree.Expression,
): ESTree.TSAsExpression | ESTree.TSTypeAssertion | null => {
  const unwrapped = unwrapExpression(expression);
  return unwrapped.type === "TSAsExpression" || unwrapped.type === "TSTypeAssertion"
    ? unwrapped
    : null;
};

const isObjectLikeType = (type: ESTree.TSType): boolean => {
  const unwrapped = unwrapType(type);
  return (
    unwrapped.type === "TSArrayType" ||
    unwrapped.type === "TSConstructorType" ||
    unwrapped.type === "TSFunctionType" ||
    unwrapped.type === "TSIntersectionType" ||
    unwrapped.type === "TSMappedType" ||
    unwrapped.type === "TSObjectKeyword" ||
    unwrapped.type === "TSTupleType" ||
    unwrapped.type === "TSTypeLiteral" ||
    unwrapped.type === "TSTypeReference"
  );
};

/** Detect annotated values that are erased through a broad local const and later asserted back. */
export const noWidenThenAssertRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow local const flows that erase an annotated value before asserting the widened binding to a narrower type.",
    },
    messages: {
      widenThenAssert:
        'Binding "{{name}}" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.',
    },
  },
  createOnce(context) {
    let environment: TypeEnvironment | null = null;

    const checkAssertion = (node: ESTree.TSAsExpression | ESTree.TSTypeAssertion) => {
      if (environment === null) return;
      const expression = unwrapExpression(node.expression);
      if (expression.type !== "Identifier") return;
      const variable = resolveVariable(context.sourceCode, expression);
      if (variable === null) return;
      const declarator = singleVariableDeclarator(variable);
      if (
        declarator === null ||
        declarator.parent.type !== "VariableDeclaration" ||
        declarator.parent.kind !== "const" ||
        declarator.id.type !== "Identifier" ||
        declarator.init === null ||
        variable.references.some((reference) => reference.isWrite() && !reference.init) ||
        node.start <= declarator.end ||
        functionBoundary(node) !== functionBoundary(declarator)
      ) {
        return;
      }

      const initializerAssertion = assertionFromExpression(declarator.init);
      const broadKind = declarator.id.typeAnnotation
        ? broadTypeKind(declarator.id.typeAnnotation.typeAnnotation, environment)
        : initializerAssertion
          ? broadTypeKind(initializerAssertion.typeAnnotation, environment)
          : null;
      if (broadKind === null || broadTypeKind(node.typeAnnotation, environment) !== null) return;

      const source = initializerAssertion?.expression ?? declarator.init;
      if (preciseSourceType(context.sourceCode, source, environment) === null) return;
      if (broadKind !== "top" && !isObjectLikeType(node.typeAnnotation)) return;

      context.report({ node, messageId: "widenThenAssert", data: { name: expression.name } });
    };

    return {
      Program(node) {
        environment = createTypeEnvironment(node);
      },
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
    };
  },
});
