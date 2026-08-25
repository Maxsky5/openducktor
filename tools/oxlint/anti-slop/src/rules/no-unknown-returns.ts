import { defineRule } from "@oxlint/plugins";

import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

import { lexicalTypeParameterNames } from "../shared/lexical-type-parameters.ts";

type FunctionWithReturnType =
  | ESTree.ArrowFunctionExpression
  | ESTree.Function
  | ESTree.TSCallSignatureDeclaration
  | ESTree.TSConstructSignatureDeclaration
  | ESTree.TSConstructorType
  | ESTree.TSFunctionType
  | ESTree.TSMethodSignature;

function referencedAliasName(type: ESTree.TSType): string | null {
  if (type.type === "TSParenthesizedType") return referencedAliasName(type.typeAnnotation);
  if (type.type !== "TSTypeReference" || type.typeName.type !== "Identifier") return null;
  return type.typeArguments === null ||
    type.typeArguments === undefined ||
    type.typeArguments.params.length === 0
    ? type.typeName.name
    : null;
}

function resolveVariable(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
): Variable | null {
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return null;
}

/** Ban function contracts that return unknown instead of a parsed domain type. */
export const noUnknownReturnsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow functions that expose unknown or Promise<unknown> to their callers.",
    },
    messages: {
      unknownReturn:
        "This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.",
    },
  },
  createOnce(context) {
    const aliases = new Map<string, ESTree.TSTypeAliasDeclaration>();

    const resolvesToUnknown = (
      type: ESTree.TSType,
      shadowedAliases: ReadonlySet<string>,
      visited = new Set<string>(),
    ): boolean => {
      if (type.type === "TSUnknownKeyword") return true;
      if (type.type === "TSIndexedAccessType" && type.indexType.type === "TSStringKeyword") {
        if (
          type.objectType.type === "TSTypeReference" &&
          type.objectType.typeName.type === "Identifier"
        ) {
          if (type.objectType.typeName.name === "UnknownRecord") return true;
          if (type.objectType.typeName.name === "Record") {
            const [key, value] = type.objectType.typeArguments?.params ?? [];
            return (
              key?.type === "TSStringKeyword" &&
              value !== undefined &&
              resolvesToUnknown(value, shadowedAliases, visited)
            );
          }
        }
      }
      if (type.type === "TSParenthesizedType") {
        return resolvesToUnknown(type.typeAnnotation, shadowedAliases, visited);
      }
      if (type.type === "TSUnionType") {
        return type.types.some((member) => resolvesToUnknown(member, shadowedAliases, visited));
      }
      if (
        type.type === "TSTypeReference" &&
        type.typeName.type === "Identifier" &&
        (type.typeName.name === "Promise" || type.typeName.name === "PromiseLike")
      ) {
        const value = type.typeArguments?.params[0];
        return value !== undefined && resolvesToUnknown(value, shadowedAliases, visited);
      }
      const name = referencedAliasName(type);
      if (name === null || visited.has(name) || shadowedAliases.has(name)) return false;
      const alias = aliases.get(name);
      if (
        alias === undefined ||
        (alias.typeParameters !== null && alias.typeParameters !== undefined)
      ) {
        return false;
      }
      const nextVisited = new Set(visited);
      nextVisited.add(name);
      return resolvesToUnknown(alias.typeAnnotation, shadowedAliases, nextVisited);
    };

    const checkReturnType = (node: FunctionWithReturnType) => {
      const annotation = node.returnType;
      if (annotation === null || annotation === undefined) return;
      if (
        !resolvesToUnknown(
          annotation.typeAnnotation,
          lexicalTypeParameterNames(node, context.sourceCode.visitorKeys),
        )
      ) {
        return;
      }
      context.report({ node: annotation.typeAnnotation, messageId: "unknownReturn" });
    };

    const expressionReturnsUnknown = (
      expression: ESTree.Expression,
      shadowedAliases: ReadonlySet<string>,
    ): boolean => {
      if (
        expression.type === "ParenthesizedExpression" ||
        expression.type === "ChainExpression" ||
        expression.type === "TSNonNullExpression"
      ) {
        return expressionReturnsUnknown(expression.expression, shadowedAliases);
      }
      if (expression.type === "AwaitExpression") {
        return expressionReturnsUnknown(expression.argument, shadowedAliases);
      }
      if (expression.type === "TSAsExpression" || expression.type === "TSTypeAssertion") {
        return resolvesToUnknown(expression.typeAnnotation, shadowedAliases);
      }
      if (expression.type === "ConditionalExpression") {
        return (
          expressionReturnsUnknown(expression.consequent, shadowedAliases) ||
          expressionReturnsUnknown(expression.alternate, shadowedAliases)
        );
      }
      if (expression.type === "LogicalExpression") {
        return (
          expressionReturnsUnknown(expression.left, shadowedAliases) ||
          expressionReturnsUnknown(expression.right, shadowedAliases)
        );
      }
      if (expression.type === "SequenceExpression") {
        const last = expression.expressions.at(-1);
        return last !== undefined && expressionReturnsUnknown(last, shadowedAliases);
      }
      if (expression.type !== "Identifier") return false;
      const variable = resolveVariable(context.sourceCode, expression);
      return (
        variable?.identifiers.some((identifier) => {
          const annotation = identifier.typeAnnotation?.typeAnnotation;
          return annotation !== undefined && resolvesToUnknown(annotation, shadowedAliases);
        }) ?? false
      );
    };

    const enclosingRuntimeFunction = (
      node: ESTree.Node,
    ): ESTree.ArrowFunctionExpression | ESTree.Function | null => {
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
    };

    const checkInferredReturn = (node: ESTree.ReturnStatement) => {
      if (node.argument === null) return;
      const owner = enclosingRuntimeFunction(node);
      if (owner === null || owner.returnType !== null) return;
      if (
        expressionReturnsUnknown(
          node.argument,
          lexicalTypeParameterNames(owner, context.sourceCode.visitorKeys),
        )
      ) {
        context.report({ node: node.argument, messageId: "unknownReturn" });
      }
    };

    const checkInferredArrowBody = (node: ESTree.ArrowFunctionExpression) => {
      if (node.returnType !== null || node.body.type === "BlockStatement") return;
      if (
        expressionReturnsUnknown(
          node.body,
          lexicalTypeParameterNames(node, context.sourceCode.visitorKeys),
        )
      ) {
        context.report({ node: node.body, messageId: "unknownReturn" });
      }
    };

    return {
      Program(node) {
        aliases.clear();
        for (const statement of node.body) {
          const declaration =
            statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
          if (declaration?.type === "TSTypeAliasDeclaration") {
            aliases.set(declaration.id.name, declaration);
          }
        }
      },
      ArrowFunctionExpression(node) {
        checkReturnType(node);
        checkInferredArrowBody(node);
      },
      FunctionDeclaration: checkReturnType,
      FunctionExpression: checkReturnType,
      TSCallSignatureDeclaration: checkReturnType,
      TSConstructSignatureDeclaration: checkReturnType,
      TSConstructorType: checkReturnType,
      TSDeclareFunction: checkReturnType,
      TSEmptyBodyFunctionExpression: checkReturnType,
      TSFunctionType: checkReturnType,
      TSMethodSignature: checkReturnType,
      ReturnStatement: checkInferredReturn,
    };
  },
});
