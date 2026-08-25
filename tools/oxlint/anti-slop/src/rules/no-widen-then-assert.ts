import { defineRule } from "@oxlint/plugins";

import {
  classifyWideningTarget,
  createTypeEnvironment,
  isKnownEvidenceExpression,
} from "../shared/dictionary-types.ts";
import { resolveVariable, singleVariableDeclarator } from "../shared/global-reference.ts";
import { createImportedWideningTypeResolver } from "../shared/imported-widening-target.ts";
import { unwrapTransparentExpression } from "../shared/transparent-expression.ts";
import { isStableBinding } from "../shared/stable-binding.ts";

import type { ESTree, SourceCode, Variable } from "@oxlint/plugins";
import type { WideningTypeResolver } from "../shared/widening-target.ts";

function hasKnownEvidence(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  visitedVariables = new Set<Variable>(),
): boolean {
  if (isKnownEvidenceExpression(expression)) return true;
  const unwrapped = unwrapTransparentExpression(expression);
  if (unwrapped.type !== "Identifier") return false;
  const variable = resolveVariable(sourceCode, unwrapped);
  if (variable === null || visitedVariables.has(variable)) return false;
  const declarator = singleVariableDeclarator(variable);
  if (declarator === null || declarator.init === null || !isStableBinding(variable, declarator)) {
    return false;
  }
  visitedVariables.add(variable);
  return hasKnownEvidence(sourceCode, declarator.init, visitedVariables);
}

function isBroadBoundaryType(
  type: ESTree.TSType,
  visitorKeys: Readonly<Record<string, readonly string[]>>,
  resolveImportedType: WideningTypeResolver,
): boolean {
  const wideningTarget = classifyWideningTarget(
    type,
    createTypeEnvironment(type, visitorKeys),
    resolveImportedType,
  );
  return (
    wideningTarget?.kind === "unknown" ||
    wideningTarget?.kind === "object" ||
    wideningTarget?.kind === "open dictionary"
  );
}

function variableHasBroadAnnotation(
  variable: Variable,
  visitorKeys: Readonly<Record<string, readonly string[]>>,
  resolveImportedType: WideningTypeResolver,
): boolean {
  return variable.identifiers.some((identifier) => {
    const annotation = identifier.typeAnnotation?.typeAnnotation;
    return (
      annotation !== undefined && isBroadBoundaryType(annotation, visitorKeys, resolveImportedType)
    );
  });
}

function isBroadBoundaryInput(
  sourceCode: SourceCode,
  variable: Variable,
  visitorKeys: Readonly<Record<string, readonly string[]>>,
  resolveImportedType: WideningTypeResolver,
): boolean {
  const identifier = variable.identifiers[0];
  if (
    identifier === undefined ||
    !variableHasBroadAnnotation(variable, visitorKeys, resolveImportedType) ||
    variable.references.some(
      (reference) =>
        reference.isWrite() &&
        !reference.init &&
        (reference.identifier.start !== identifier.start ||
          reference.identifier.end !== identifier.end),
    )
  ) {
    return false;
  }

  const declarator = singleVariableDeclarator(variable);
  return (
    declarator === null ||
    declarator.init === null ||
    !hasKnownEvidence(sourceCode, declarator.init)
  );
}

function aliasedIdentifier(
  expression: ESTree.Expression,
  visitorKeys: Readonly<Record<string, readonly string[]>>,
  resolveImportedType: WideningTypeResolver,
): ESTree.IdentifierReference | null {
  let current = unwrapTransparentExpression(expression);
  if (current.type === "TSAsExpression" || current.type === "TSTypeAssertion") {
    if (!isBroadBoundaryType(current.typeAnnotation, visitorKeys, resolveImportedType)) return null;
    current = unwrapTransparentExpression(current.expression);
  }
  return current.type === "Identifier" ? current : null;
}

function aliasesBroadBoundaryInput(
  sourceCode: SourceCode,
  assertedIdentifier: ESTree.IdentifierReference,
  assertion: ESTree.TSAsExpression | ESTree.TSTypeAssertion,
  visitorKeys: Readonly<Record<string, readonly string[]>>,
  resolveImportedType: WideningTypeResolver,
): boolean {
  let variable = resolveVariable(sourceCode, assertedIdentifier);
  const visited = new Set<Variable>();
  let aliasCount = 0;

  while (variable !== null && !visited.has(variable)) {
    visited.add(variable);
    const declarator = singleVariableDeclarator(variable);
    if (
      declarator !== null &&
      declarator.init !== null &&
      declarator.end < assertion.start &&
      isStableBinding(variable, declarator)
    ) {
      const sourceIdentifier = aliasedIdentifier(declarator.init, visitorKeys, resolveImportedType);
      if (sourceIdentifier !== null) {
        aliasCount += 1;
        variable = resolveVariable(sourceCode, sourceIdentifier);
        continue;
      }
    }

    return (
      aliasCount > 0 && isBroadBoundaryInput(sourceCode, variable, visitorKeys, resolveImportedType)
    );
  }

  return false;
}

/** Detect local aliases that conceal a broad boundary input before a narrow assertion. */
export const noWidenThenAssertRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow laundering an accepted broad boundary input through local aliases before asserting it to a narrower type.",
    },
    messages: {
      widenThenAssert:
        'Binding "{{name}}" aliases a broad boundary input before asserting a narrower type. Parse or assert the boundary input directly, then keep the parsed owner type.',
    },
  },
  createOnce(context) {
    let resolveImportedType: WideningTypeResolver | null = null;
    const importedTypeResolver = (node: ESTree.Node): WideningTypeResolver => {
      if (resolveImportedType !== null) return resolveImportedType;
      let root = node;
      while (root.parent !== null) root = root.parent;
      resolveImportedType = createImportedWideningTypeResolver(
        context.filename,
        root.type === "Program" ? root.body : [],
      );
      return resolveImportedType;
    };
    const checkAssertion = (node: ESTree.TSAsExpression | ESTree.TSTypeAssertion): void => {
      const visitorKeys = context.sourceCode.visitorKeys;
      const resolver = importedTypeResolver(node);
      if (isBroadBoundaryType(node.typeAnnotation, visitorKeys, resolver)) return;
      const expression = unwrapTransparentExpression(node.expression);
      if (
        expression.type !== "Identifier" ||
        !aliasesBroadBoundaryInput(context.sourceCode, expression, node, visitorKeys, resolver)
      ) {
        return;
      }

      context.report({
        node,
        messageId: "widenThenAssert",
        data: { name: expression.name },
      });
    };

    return {
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
    };
  },
});
