import { defineRule } from "@oxlint/plugins";

import {
  classifyWideningTarget,
  createTypeEnvironment,
  isKnownEvidenceExpression,
  type WideningTarget,
} from "../shared/dictionary-types.ts";
import { resolveVariable, singleVariableDeclarator } from "../shared/global-reference.ts";
import { createImportedWideningTypeResolver } from "../shared/imported-widening-target.ts";
import { unwrapTransparentExpression } from "../shared/transparent-expression.ts";
import { isStableBinding } from "../shared/stable-binding.ts";

import type { ESTree, SourceCode, Variable } from "@oxlint/plugins";

type FunctionExpression = ESTree.ArrowFunctionExpression | ESTree.Function;

function hasKnownEvidence(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  visitedVariables = new Set<Variable>(),
): boolean {
  if (isKnownEvidenceExpression(expression)) return true;
  const unwrapped = unwrapTransparentExpression(expression, { includeTypeAssertions: true });
  if (unwrapped.type === "ConditionalExpression") {
    return (
      hasKnownEvidence(sourceCode, unwrapped.consequent, visitedVariables) &&
      hasKnownEvidence(sourceCode, unwrapped.alternate, visitedVariables)
    );
  }
  if (unwrapped.type === "LogicalExpression") {
    return (
      hasKnownEvidence(sourceCode, unwrapped.left, visitedVariables) &&
      hasKnownEvidence(sourceCode, unwrapped.right, visitedVariables)
    );
  }
  if (unwrapped.type === "SequenceExpression") {
    const result = unwrapped.expressions.at(-1);
    return result !== undefined && hasKnownEvidence(sourceCode, result, visitedVariables);
  }
  if (unwrapped.type !== "Identifier") return false;
  const variable = resolveVariable(sourceCode, unwrapped);
  if (variable === null || visitedVariables.has(variable)) return false;
  const declarator = singleVariableDeclarator(variable);
  if (declarator === null || declarator.init === null || !isStableBinding(variable, declarator)) {
    return false;
  }
  const nextVisitedVariables = new Set(visitedVariables);
  nextVisitedVariables.add(variable);
  return hasKnownEvidence(sourceCode, declarator.init, nextVisitedVariables);
}

function typeTarget(
  type: ESTree.TSType,
  filename: string,
  visitorKeys: Readonly<Record<string, readonly string[]>>,
): WideningTarget | null {
  const environment = createTypeEnvironment(type, visitorKeys);
  let root: ESTree.Node = type;
  while (root.parent !== null) root = root.parent;
  const resolveImportedType =
    root.type === "Program" ? createImportedWideningTypeResolver(filename, root.body) : undefined;
  return classifyWideningTarget(type, environment, resolveImportedType);
}

function annotationTarget(
  annotation: ESTree.TSTypeAnnotation | null | undefined,
  filename: string,
  visitorKeys: Readonly<Record<string, readonly string[]>>,
): WideningTarget | null {
  return annotation === null || annotation === undefined
    ? null
    : typeTarget(annotation.typeAnnotation, filename, visitorKeys);
}

function enclosingFunction(node: ESTree.Node): FunctionExpression | null {
  let current: ESTree.Node | null = node.parent;
  while (current !== null && current.type !== "Program") {
    if (
      current.type === "ArrowFunctionExpression" ||
      current.type === "FunctionDeclaration" ||
      current.type === "FunctionExpression"
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function sourceKeyName(sourceCode: SourceCode, key: ESTree.PropertyKey): string {
  if (key.type === "Identifier" || key.type === "PrivateIdentifier") return key.name;
  if (key.type === "Literal") return String(key.value);
  return sourceCode.getText(key);
}

function functionName(sourceCode: SourceCode, owner: FunctionExpression | null): string {
  if (owner === null) return "anonymous function";
  if (owner.id !== null) return owner.id.name;
  const parent = owner.parent;
  if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier")
    return parent.id.name;
  if (parent.type === "MethodDefinition") return sourceKeyName(sourceCode, parent.key);
  return "anonymous function";
}

function isEmptyObjectExpression(expression: ESTree.Expression): boolean {
  const unwrapped = unwrapTransparentExpression(expression, { includeTypeAssertions: true });
  return unwrapped.type === "ObjectExpression" && unwrapped.properties.length === 0;
}

function isDictionaryAccumulatorTarget(destination: WideningTarget): boolean {
  return destination.kind === "open dictionary";
}

function hasParentAssertion(node: ESTree.Node): boolean {
  return node.parent?.type === "TSAsExpression" || node.parent?.type === "TSTypeAssertion";
}

/** Detect sound syntactic cases where a known value is explicitly widened and loses evidence. */
export const noKnownValueWideningRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow syntactically established values from flowing into explicitly broad or anonymous target types that discard useful evidence.",
    },
    messages: {
      widening:
        "The explicit {{target}} type on {{subject}} discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.",
    },
  },
  createOnce(context) {
    const reportFlow = (
      expression: ESTree.Expression,
      destination: () => WideningTarget | null,
      subject: string,
    ) => {
      if (!hasKnownEvidence(context.sourceCode, expression)) return;
      const resolvedDestination = destination();
      if (resolvedDestination === null) return;
      if (
        isDictionaryAccumulatorTarget(resolvedDestination) &&
        isEmptyObjectExpression(expression)
      ) {
        return;
      }
      context.report({
        node: expression,
        messageId: "widening",
        data: { subject, target: resolvedDestination.kind },
      });
    };

    const targetFromAnnotation = (annotation: ESTree.TSTypeAnnotation | null | undefined) => () =>
      annotationTarget(annotation, context.filename, context.sourceCode.visitorKeys);

    return {
      VariableDeclarator(node) {
        if (node.init === null) return;
        const subject =
          node.id.type === "Identifier" ? `binding \`${node.id.name}\`` : "destructuring binding";
        reportFlow(node.init, targetFromAnnotation(node.id.typeAnnotation), subject);
      },
      PropertyDefinition(node) {
        if (node.value === null) return;
        reportFlow(
          node.value,
          targetFromAnnotation(node.typeAnnotation),
          `property \`${sourceKeyName(context.sourceCode, node.key)}\``,
        );
      },
      AccessorProperty(node) {
        if (node.value === null) return;
        reportFlow(
          node.value,
          targetFromAnnotation(node.typeAnnotation),
          `property \`${sourceKeyName(context.sourceCode, node.key)}\``,
        );
      },
      AssignmentExpression(node) {
        if (node.operator !== "=" || node.left.type !== "Identifier") return;
        const variable = resolveVariable(context.sourceCode, node.left);
        if (variable === null) return;
        const declarator = singleVariableDeclarator(variable);
        if (declarator === null || declarator.id.type !== "Identifier") return;
        reportFlow(
          node.right,
          targetFromAnnotation(declarator.id.typeAnnotation),
          `binding \`${declarator.id.name}\``,
        );
      },
      ReturnStatement(node) {
        if (node.argument === null) return;
        const owner = enclosingFunction(node);
        reportFlow(
          node.argument,
          targetFromAnnotation(owner?.returnType),
          `return value of \`${functionName(context.sourceCode, owner)}\``,
        );
      },
      ArrowFunctionExpression(node) {
        if (node.body.type === "BlockStatement") return;
        reportFlow(
          node.body,
          targetFromAnnotation(node.returnType),
          `return value of \`${functionName(context.sourceCode, node)}\``,
        );
      },
      TSAsExpression(node) {
        if (hasParentAssertion(node)) return;
        reportFlow(
          node.expression,
          () => typeTarget(node.typeAnnotation, context.filename, context.sourceCode.visitorKeys),
          "assertion",
        );
      },
      TSTypeAssertion(node) {
        if (hasParentAssertion(node)) return;
        reportFlow(
          node.expression,
          () => typeTarget(node.typeAnnotation, context.filename, context.sourceCode.visitorKeys),
          "assertion",
        );
      },
      TSSatisfiesExpression(node) {
        if (node.typeAnnotation.type !== "TSUnknownKeyword") return;
        reportFlow(
          node.expression,
          () =>
            classifyWideningTarget(
              node.typeAnnotation,
              createTypeEnvironment(node.typeAnnotation, context.sourceCode.visitorKeys),
            ),
          "satisfies expression",
        );
      },
    };
  },
});
