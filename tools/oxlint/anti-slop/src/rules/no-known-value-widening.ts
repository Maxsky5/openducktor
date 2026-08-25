import { defineRule } from "@oxlint/plugins";

import {
  classifyWideningTarget,
  createTypeEnvironment,
  isKnownEvidenceExpression,
  type TypeEnvironment,
  type WideningTarget,
} from "../shared/dictionary-types.ts";
import { classifyImportedWideningTarget } from "../shared/imported-widening-target.ts";
import { unwrapTransparentExpression } from "../shared/transparent-expression.ts";
import { isStableBinding } from "../shared/stable-binding.ts";

import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";
import type { WideningTypeArgument } from "../shared/widening-target.ts";

type FunctionExpression = ESTree.ArrowFunctionExpression | ESTree.Function;

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

function variableDeclarator(variable: Variable): ESTree.VariableDeclarator | null {
  if (variable.defs.length !== 1) return null;
  const [definition] = variable.defs;
  return definition?.type === "Variable" && definition.node.type === "VariableDeclarator"
    ? definition.node
    : null;
}

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
  const declarator = variableDeclarator(variable);
  if (declarator === null || declarator.init === null || !isStableBinding(variable, declarator)) {
    return false;
  }
  visitedVariables.add(variable);
  return hasKnownEvidence(sourceCode, declarator.init, visitedVariables);
}

function typeTarget(
  type: ESTree.TSType,
  filename: string,
  visitorKeys: Readonly<Record<string, readonly string[]>>,
): WideningTarget | null {
  const environment = createTypeEnvironment(type, visitorKeys);
  const syntacticTarget = classifyWideningTarget(type, environment);
  if (syntacticTarget !== null) return syntacticTarget;
  const importedType = importedTypeReference(type, environment);
  return importedType === null
    ? null
    : classifyImportedWideningTarget(
        filename,
        importedType.moduleSpecifier,
        importedType.exportedName,
        importedType.arguments,
      );
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

function leftmostTypeName(typeName: ESTree.TSTypeName): string | null {
  if (typeName.type === "Identifier") return typeName.name;
  if (typeName.type === "ThisExpression") return null;
  return leftmostTypeName(typeName.left);
}

type ImportedTypeReference = {
  readonly arguments: readonly WideningTypeArgument[];
  readonly exportedName: string;
  readonly moduleSpecifier: string;
};

type ScopedType = {
  readonly environment: TypeEnvironment;
  readonly type: ESTree.TSType;
};

type TypeSubstitutions = ReadonlyMap<string, ScopedType>;

function rightmostTypeName(typeName: ESTree.TSTypeName): string | null {
  if (typeName.type === "Identifier") return typeName.name;
  if (typeName.type === "ThisExpression") return null;
  return typeName.right.name;
}

function resolveSubstitution(
  scopedType: ScopedType,
  substitutions: TypeSubstitutions,
  resolving = new Set<string>(),
): ScopedType {
  if (scopedType.type.type !== "TSTypeReference") return scopedType;
  const name = leftmostTypeName(scopedType.type.typeName);
  if (
    name === null ||
    scopedType.type.typeName.type !== "Identifier" ||
    (scopedType.type.typeArguments?.params.length ?? 0) > 0 ||
    resolving.has(name)
  ) {
    return scopedType;
  }
  const substitution = substitutions.get(name);
  if (substitution === undefined) return scopedType;
  const nextResolving = new Set(resolving);
  nextResolving.add(name);
  return resolveSubstitution(substitution, substitutions, nextResolving);
}

function directImportedTypeReference(
  type: ESTree.TSTypeReference,
  environment: TypeEnvironment,
  substitutions: TypeSubstitutions,
): ImportedTypeReference | null {
  if (type.type !== "TSTypeReference") return null;
  const localName = leftmostTypeName(type.typeName);
  if (localName === null) return null;
  let current: ESTree.Node | null = type;
  while (current.parent !== null) current = current.parent;
  if (current.type !== "Program") return null;
  for (const statement of current.body) {
    if (statement.type !== "ImportDeclaration") continue;
    for (const specifier of statement.specifiers) {
      if (specifier.local.name !== localName) continue;
      const arguments_ = (type.typeArguments?.params ?? []).map((argument) =>
        resolveSubstitution({ environment, type: argument }, substitutions),
      );
      if (specifier.type === "ImportDefaultSpecifier") {
        return {
          arguments: arguments_,
          exportedName: "default",
          moduleSpecifier: statement.source.value,
        };
      }
      if (specifier.type === "ImportNamespaceSpecifier") {
        const exportedName = rightmostTypeName(type.typeName);
        return exportedName === null
          ? null
          : { arguments: arguments_, exportedName, moduleSpecifier: statement.source.value };
      }
      return {
        arguments: arguments_,
        exportedName:
          specifier.imported.type === "Identifier"
            ? specifier.imported.name
            : specifier.imported.value,
        moduleSpecifier: statement.source.value,
      };
    }
  }
  return null;
}

function importedTypeReference(
  type: ESTree.TSType,
  environment: TypeEnvironment,
  substitutions: TypeSubstitutions = new Map(),
  resolvingAliases = new Set<ESTree.TSTypeAliasDeclaration>(),
): ImportedTypeReference | null {
  const resolved = resolveSubstitution({ environment, type }, substitutions);
  if (resolved.type !== type || resolved.environment !== environment) {
    return importedTypeReference(resolved.type, resolved.environment, new Map(), resolvingAliases);
  }
  if (type.type !== "TSTypeReference") return null;
  const imported = directImportedTypeReference(type, environment, substitutions);
  if (imported !== null) return imported;
  if (type.typeName.type !== "Identifier") return null;
  const alias = environment.aliases.get(type.typeName.name);
  if (alias === undefined || resolvingAliases.has(alias)) return null;
  const suppliedArguments = (type.typeArguments?.params ?? []).map((argument) =>
    resolveSubstitution({ environment, type: argument }, substitutions),
  );
  const aliasEnvironment = createTypeEnvironment(alias.typeAnnotation, environment.visitorKeys);
  const aliasSubstitutions = new Map<string, ScopedType>();
  for (const [index, parameter] of (alias.typeParameters?.params ?? []).entries()) {
    const suppliedArgument = suppliedArguments[index];
    const defaultType = parameter.default;
    let argument: ScopedType;
    if (suppliedArgument !== undefined) {
      argument = suppliedArgument;
    } else {
      if (defaultType === null || defaultType === undefined) return null;
      argument = { environment: aliasEnvironment, type: defaultType };
    }
    aliasSubstitutions.set(parameter.name.name, argument);
  }
  const nextResolving = new Set(resolvingAliases);
  nextResolving.add(alias);
  return importedTypeReference(
    alias.typeAnnotation,
    aliasEnvironment,
    aliasSubstitutions,
    nextResolving,
  );
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
        if (node.init === null || node.id.type !== "Identifier") return;
        reportFlow(
          node.init,
          targetFromAnnotation(node.id.typeAnnotation),
          `binding \`${node.id.name}\``,
        );
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
        const declarator = variableDeclarator(variable);
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
