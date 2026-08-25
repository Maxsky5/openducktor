import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode, Variable } from "@oxlint/plugins";

import {
  createTypeEnvironment,
  typeResolvesToAny,
  typeResolvesToUnknown,
} from "../shared/dictionary-types.ts";
import { unwrapTransparentExpression } from "../shared/transparent-expression.ts";
import { resolveVariable } from "../shared/global-reference.ts";
import { isStableBinding } from "../shared/stable-binding.ts";
import {
  isBuiltInType,
  referencedTypeScopes,
  typeReferenceName,
  type TypeEnvironment,
} from "../shared/type-environment.ts";

type RuntimeFunction = ESTree.ArrowFunctionExpression | ESTree.Function;
type StableAlias =
  | {
      readonly expression: ESTree.Expression;
      readonly kind: "expression";
      readonly variable: Variable;
    }
  | {
      readonly body: ESTree.BlockStatement;
      readonly kind: "function";
      readonly variable: Variable;
    };

type Parameter = ESTree.ParamPattern;
type ScopedType = {
  readonly environment: TypeEnvironment;
  readonly substitutions: ReadonlyMap<string, ScopedType>;
  readonly type: ESTree.TSType;
};
type ReferencedAliasType = ScopedType & {
  readonly declaration: ESTree.Node;
};

function parameterAnnotation(parameter: Parameter): ESTree.TSTypeAnnotation | null | undefined {
  if (parameter.type === "TSParameterProperty") {
    return parameterAnnotation(parameter.parameter);
  }
  if (parameter.type === "RestElement") {
    return parameter.typeAnnotation ?? parameterAnnotation(parameter.argument);
  }
  if (parameter.type === "AssignmentPattern") {
    return parameter.typeAnnotation ?? parameter.left.typeAnnotation;
  }
  return parameter.typeAnnotation;
}

function parameterName(parameter: Parameter, sourceText: string): string {
  if (parameter.type === "TSParameterProperty") {
    return parameterName(parameter.parameter, sourceText);
  }
  if (parameter.type === "AssignmentPattern") {
    return parameterName(parameter.left, sourceText);
  }
  if (parameter.type === "RestElement") {
    return parameterName(parameter.argument, sourceText);
  }
  return parameter.type === "Identifier"
    ? parameter.name
    : sourceText.replace(/\s*:\s*unknown\s*$/u, "");
}

function staticPropertyName(key: ESTree.Node, computed: boolean): string | null {
  if (!computed && key.type === "Identifier") return key.name;
  return key.type === "Literal" && typeof key.value === "string" ? key.value : null;
}

function unwrapTupleElement(type: ESTree.TSTupleElement): ESTree.TSType {
  let current = type;
  while (
    current.type === "TSOptionalType" ||
    current.type === "TSRestType" ||
    current.type === "TSNamedTupleMember"
  ) {
    current = current.type === "TSNamedTupleMember" ? current.elementType : current.typeAnnotation;
  }
  return current;
}

function declarationSubstitutions(
  parameters: ESTree.TSTypeParameterDeclaration | null | undefined,
  arguments_: ESTree.TSTypeParameterInstantiation | null | undefined,
  referenceType: ScopedType,
): ReadonlyMap<string, ScopedType> {
  const substitutions = new Map(referenceType.substitutions);
  for (const [index, parameter] of (parameters?.params ?? []).entries()) {
    const argument = arguments_?.params[index] ?? parameter.default;
    if (argument === null || argument === undefined) continue;
    substitutions.set(parameter.name.name, {
      environment:
        arguments_?.params[index] === undefined
          ? createTypeEnvironment(argument, referenceType.environment.visitorKeys)
          : referenceType.environment,
      substitutions,
      type: argument,
    });
  }
  return substitutions;
}

function unwrappedScopedType(scopedType: ScopedType): ScopedType {
  let current = scopedType;
  const resolving = new Set<string>();
  for (;;) {
    if (
      current.type.type === "TSParenthesizedType" ||
      (current.type.type === "TSTypeOperator" && current.type.operator === "readonly")
    ) {
      current = { ...current, type: current.type.typeAnnotation };
      continue;
    }
    if (current.type.type !== "TSTypeReference") return current;
    const name = typeReferenceName(current.type);
    if (name === null || resolving.has(name)) return current;
    const substitution = current.substitutions.get(name);
    if (substitution === undefined) return current;
    resolving.add(name);
    current = substitution;
  }
}

function referencedAliasTypes(
  scopedType: ScopedType,
  resolving: ReadonlySet<ESTree.Node>,
): readonly ReferencedAliasType[] {
  const unwrapped = unwrappedScopedType(scopedType);
  if (unwrapped.type.type !== "TSTypeReference") return [];
  const reference = unwrapped.type;
  const name = typeReferenceName(reference);
  if (
    name !== null &&
    isBuiltInType(name, unwrapped.environment) &&
    (name === "Readonly" || name === "Partial" || name === "Required" || name === "NonNullable")
  ) {
    const wrapped = reference.typeArguments?.params[0];
    return wrapped === undefined
      ? []
      : [{ ...unwrapped, declaration: unwrapped.type, type: wrapped }];
  }
  return referencedTypeScopes(reference.typeName, unwrapped.environment).flatMap((scope) => {
    const alias = scope.environment.aliases.get(scope.name);
    if (alias === undefined || resolving.has(alias)) return [];
    return [
      {
        declaration: alias,
        environment: createTypeEnvironment(alias.typeAnnotation, unwrapped.environment.visitorKeys),
        substitutions: declarationSubstitutions(
          alias.typeParameters,
          reference.typeArguments,
          unwrapped,
        ),
        type: alias.typeAnnotation,
      },
    ];
  });
}

function objectPropertyTypes(
  scopedType: ScopedType,
  propertyName: string,
  resolving: ReadonlySet<ESTree.Node> = new Set(),
): readonly ScopedType[] {
  const unwrapped = unwrappedScopedType(scopedType);
  if (unwrapped.type.type === "TSUnionType" || unwrapped.type.type === "TSIntersectionType") {
    return unwrapped.type.types.flatMap((member) =>
      objectPropertyTypes({ ...unwrapped, type: member }, propertyName, resolving),
    );
  }
  if (unwrapped.type.type === "TSTypeLiteral") {
    return unwrapped.type.members.flatMap((member): readonly ScopedType[] => {
      if (
        member.type !== "TSPropertySignature" ||
        member.typeAnnotation === null ||
        staticPropertyName(member.key, member.computed) !== propertyName
      ) {
        return [];
      }
      const type = member.typeAnnotation.typeAnnotation;
      return [
        {
          environment: createTypeEnvironment(type, unwrapped.environment.visitorKeys),
          substitutions: unwrapped.substitutions,
          type,
        },
      ];
    });
  }
  if (unwrapped.type.type !== "TSTypeReference") return [];
  const reference = unwrapped.type;

  const aliasMembers = referencedAliasTypes(unwrapped, resolving).flatMap((alias) => {
    const nextResolving = new Set(resolving);
    nextResolving.add(alias.declaration);
    return objectPropertyTypes(alias, propertyName, nextResolving);
  });
  const interfaceMembers = referencedTypeScopes(reference.typeName, unwrapped.environment).flatMap(
    (scope) =>
      (scope.environment.interfaces.get(scope.name) ?? []).flatMap(
        (declaration): readonly ScopedType[] => {
          if (resolving.has(declaration)) return [];
          const substitutions = declarationSubstitutions(
            declaration.typeParameters,
            reference.typeArguments,
            unwrapped,
          );
          return declaration.body.body.flatMap((member): readonly ScopedType[] => {
            if (
              member.type !== "TSPropertySignature" ||
              member.typeAnnotation === null ||
              staticPropertyName(member.key, member.computed) !== propertyName
            ) {
              return [];
            }
            const type = member.typeAnnotation.typeAnnotation;
            return [
              {
                environment: createTypeEnvironment(type, unwrapped.environment.visitorKeys),
                substitutions,
                type,
              },
            ];
          });
        },
      ),
  );
  return [...aliasMembers, ...interfaceMembers];
}

function tupleElementTypes(
  scopedType: ScopedType,
  index: number,
  resolving: ReadonlySet<ESTree.Node> = new Set(),
): readonly ScopedType[] {
  const unwrapped = unwrappedScopedType(scopedType);
  if (unwrapped.type.type === "TSUnionType" || unwrapped.type.type === "TSIntersectionType") {
    return unwrapped.type.types.flatMap((member) =>
      tupleElementTypes({ ...unwrapped, type: member }, index, resolving),
    );
  }
  if (unwrapped.type.type === "TSTupleType") {
    const element = unwrapped.type.elementTypes[index];
    return element === undefined ? [] : [{ ...unwrapped, type: unwrapTupleElement(element) }];
  }
  if (unwrapped.type.type === "TSArrayType") {
    return [{ ...unwrapped, type: unwrapped.type.elementType }];
  }
  if (unwrapped.type.type !== "TSTypeReference" || resolving.has(unwrapped.type)) return [];
  return referencedAliasTypes(unwrapped, resolving).flatMap((alias) => {
    const nextResolving = new Set(resolving);
    nextResolving.add(alias.declaration);
    return tupleElementTypes(alias, index, nextResolving);
  });
}

function unknownBindingVariables(
  pattern: Parameter | ESTree.BindingPattern,
  scopedType: ScopedType,
  sourceCode: SourceCode,
): readonly Variable[] {
  if (pattern.type === "TSParameterProperty") {
    return unknownBindingVariables(pattern.parameter, scopedType, sourceCode);
  }
  if (pattern.type === "AssignmentPattern") {
    return unknownBindingVariables(pattern.left, scopedType, sourceCode);
  }
  if (pattern.type === "RestElement") return [];
  if (pattern.type === "Identifier") {
    const unwrapped = unwrappedScopedType(scopedType);
    if (!typeResolvesToUnknown(unwrapped.type, unwrapped.environment, unwrapped.substitutions)) {
      return [];
    }
    const variable = resolveVariable(sourceCode, pattern);
    return variable === null ? [] : [variable];
  }
  if (pattern.type === "ObjectPattern") {
    return pattern.properties.flatMap((property): readonly Variable[] => {
      if (property.type === "RestElement") return [];
      const name = staticPropertyName(property.key, property.computed);
      if (name === null) return [];
      return objectPropertyTypes(scopedType, name).flatMap((propertyType) =>
        unknownBindingVariables(property.value, propertyType, sourceCode),
      );
    });
  }
  return pattern.elements.flatMap((element, index): readonly Variable[] => {
    if (element === null || element.type === "RestElement") return [];
    return tupleElementTypes(scopedType, index).flatMap((elementType) =>
      unknownBindingVariables(element, elementType, sourceCode),
    );
  });
}

function enclosingRuntimeFunction(node: ESTree.Node): RuntimeFunction | null {
  let current = node.parent;
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

function stableAliasInitializer(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
  resolvingAliases: ReadonlySet<Variable>,
): StableAlias | null {
  const variable = resolveVariable(sourceCode, identifier);
  if (variable === null || resolvingAliases.has(variable) || variable.defs.length !== 1)
    return null;
  const definition = variable.defs[0];
  if (
    definition?.type === "FunctionName" &&
    definition.node.type === "FunctionDeclaration" &&
    definition.node.body !== null &&
    variable.references.every((reference) => !reference.isWrite())
  ) {
    return { body: definition.node.body, kind: "function", variable };
  }
  if (
    definition?.type !== "Variable" ||
    definition.node.type !== "VariableDeclarator" ||
    definition.node.id.type !== "Identifier" ||
    definition.node.init === null ||
    !isStableBinding(variable, definition.node)
  ) {
    return null;
  }
  return { expression: definition.node.init, kind: "expression", variable };
}

function directlyExposesParameter(
  expression: ESTree.Expression,
  parameterVariable: Variable,
  sourceCode: SourceCode,
  resolvingAliases: ReadonlySet<Variable> = new Set(),
): boolean {
  const unwrapped = unwrapTransparentExpression(expression, { includeTypeAssertions: true });
  if (unwrapped !== expression) {
    return directlyExposesParameter(unwrapped, parameterVariable, sourceCode, resolvingAliases);
  }
  if (expression.type === "Identifier") {
    if (resolveVariable(sourceCode, expression) === parameterVariable) return true;
    const alias = stableAliasInitializer(sourceCode, expression, resolvingAliases);
    if (alias === null) return false;
    const nextResolving = new Set(resolvingAliases);
    nextResolving.add(alias.variable);
    return alias.kind === "expression"
      ? directlyExposesParameter(alias.expression, parameterVariable, sourceCode, nextResolving)
      : alias.body.body.some((statement) =>
          statementReturnsParameter(statement, parameterVariable, sourceCode, nextResolving),
        );
  }
  if (expression.type === "ChainExpression")
    return directlyExposesParameter(
      expression.expression,
      parameterVariable,
      sourceCode,
      resolvingAliases,
    );
  if (expression.type === "ArrowFunctionExpression" || expression.type === "FunctionExpression") {
    if (expression.body === null) return false;
    return expression.body.type === "BlockStatement"
      ? expression.body.body.some((statement) =>
          statementReturnsParameter(statement, parameterVariable, sourceCode, resolvingAliases),
        )
      : directlyExposesParameter(expression.body, parameterVariable, sourceCode, resolvingAliases);
  }
  if (expression.type === "AwaitExpression") {
    return directlyExposesParameter(
      expression.argument,
      parameterVariable,
      sourceCode,
      resolvingAliases,
    );
  }
  if (expression.type === "ConditionalExpression") {
    return (
      directlyExposesParameter(
        expression.consequent,
        parameterVariable,
        sourceCode,
        resolvingAliases,
      ) ||
      directlyExposesParameter(
        expression.alternate,
        parameterVariable,
        sourceCode,
        resolvingAliases,
      )
    );
  }
  if (expression.type === "LogicalExpression") {
    return (
      directlyExposesParameter(expression.left, parameterVariable, sourceCode, resolvingAliases) ||
      directlyExposesParameter(expression.right, parameterVariable, sourceCode, resolvingAliases)
    );
  }
  if (expression.type === "SequenceExpression") {
    const lastExpression = expression.expressions.at(-1);
    return (
      lastExpression !== undefined &&
      directlyExposesParameter(lastExpression, parameterVariable, sourceCode, resolvingAliases)
    );
  }
  if (expression.type === "MemberExpression" && expression.object.type !== "Super") {
    return directlyExposesParameter(
      expression.object,
      parameterVariable,
      sourceCode,
      resolvingAliases,
    );
  }
  if (expression.type === "ArrayExpression") {
    return expression.elements.some(
      (element) =>
        element !== null &&
        directlyExposesParameter(
          element.type === "SpreadElement" ? element.argument : element,
          parameterVariable,
          sourceCode,
          resolvingAliases,
        ),
    );
  }
  if (expression.type === "ObjectExpression") {
    return expression.properties.some((property) =>
      directlyExposesParameter(
        property.type === "SpreadElement" ? property.argument : property.value,
        parameterVariable,
        sourceCode,
        resolvingAliases,
      ),
    );
  }
  if (expression.type === "TemplateLiteral") {
    return expression.expressions.some((part) =>
      directlyExposesParameter(part, parameterVariable, sourceCode, resolvingAliases),
    );
  }
  return false;
}

function statementReturnsParameter(
  statement: ESTree.Statement,
  parameterVariable: Variable,
  sourceCode: SourceCode,
  resolvingAliases: ReadonlySet<Variable> = new Set(),
): boolean {
  if (statement.type === "ReturnStatement") {
    return (
      statement.argument !== null &&
      directlyExposesParameter(statement.argument, parameterVariable, sourceCode, resolvingAliases)
    );
  }
  if (statement.type === "BlockStatement") {
    return statement.body.some((child) =>
      statementReturnsParameter(child, parameterVariable, sourceCode, resolvingAliases),
    );
  }
  if (statement.type === "IfStatement") {
    return (
      statementReturnsParameter(
        statement.consequent,
        parameterVariable,
        sourceCode,
        resolvingAliases,
      ) ||
      (statement.alternate !== null &&
        statementReturnsParameter(
          statement.alternate,
          parameterVariable,
          sourceCode,
          resolvingAliases,
        ))
    );
  }
  if (statement.type === "SwitchStatement") {
    return statement.cases.some((case_) =>
      case_.consequent.some((child) =>
        statementReturnsParameter(child, parameterVariable, sourceCode, resolvingAliases),
      ),
    );
  }
  if (statement.type === "TryStatement") {
    return (
      statementReturnsParameter(statement.block, parameterVariable, sourceCode, resolvingAliases) ||
      (statement.handler !== null &&
        statementReturnsParameter(
          statement.handler.body,
          parameterVariable,
          sourceCode,
          resolvingAliases,
        )) ||
      (statement.finalizer !== null &&
        statementReturnsParameter(
          statement.finalizer,
          parameterVariable,
          sourceCode,
          resolvingAliases,
        ))
    );
  }
  return false;
}

function hasKnownOutputContract(
  functionNode: RuntimeFunction,
  visitorKeys: Readonly<Record<string, readonly string[]>>,
): boolean {
  const returnType = functionNode.returnType?.typeAnnotation;
  if (returnType === undefined) return false;
  const environment = createTypeEnvironment(returnType, visitorKeys);
  return (
    !typeResolvesToAny(returnType, environment) && !typeResolvesToUnknown(returnType, environment)
  );
}

/** Reject direct exposure and assertion of explicitly unknown runtime inputs. */
export const noUnknownParametersRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow inferred returns and type assertions that directly expose an explicitly unknown parameter.",
    },
    messages: {
      unknownParameter:
        "Parameter `{{parameter}}` is exposed without a checked output contract. Narrow it under an explicit return type or pass it to the boundary parser that owns the input contract.",
    },
  },
  createOnce(context) {
    const reportedParameters = new WeakSet<ESTree.TSTypeAnnotation>();

    const report = (parameter: Parameter): void => {
      const annotation = parameterAnnotation(parameter);
      if (annotation === null || annotation === undefined || reportedParameters.has(annotation)) {
        return;
      }
      reportedParameters.add(annotation);
      context.report({
        node: annotation.typeAnnotation,
        messageId: "unknownParameter",
        data: { parameter: parameterName(parameter, context.sourceCode.getText(parameter)) },
      });
    };

    const resolvedUnknownBindings = (parameter: Parameter): readonly Variable[] => {
      const annotation = parameterAnnotation(parameter);
      if (annotation === null || annotation === undefined) return [];
      const environment = createTypeEnvironment(
        annotation.typeAnnotation,
        context.sourceCode.visitorKeys,
      );
      return unknownBindingVariables(
        parameter,
        { environment, substitutions: new Map(), type: annotation.typeAnnotation },
        context.sourceCode,
      );
    };

    const checkAssertion = (node: ESTree.TSAsExpression | ESTree.TSTypeAssertion): void => {
      const functionNode = enclosingRuntimeFunction(node);
      if (functionNode === null) return;
      for (const parameter of functionNode.params) {
        if (
          resolvedUnknownBindings(parameter).some((variable) =>
            directlyExposesParameter(node.expression, variable, context.sourceCode),
          )
        ) {
          report(parameter);
        }
      }
    };

    return {
      ArrowFunctionExpression(node) {
        if (
          node.body.type === "BlockStatement" ||
          hasKnownOutputContract(node, context.sourceCode.visitorKeys)
        ) {
          return;
        }
        const body = node.body;
        for (const parameter of node.params) {
          if (
            resolvedUnknownBindings(parameter).some((variable) =>
              directlyExposesParameter(body, variable, context.sourceCode),
            )
          ) {
            report(parameter);
          }
        }
      },
      ReturnStatement(node) {
        if (node.argument === null) return;
        const argument = node.argument;
        const functionNode = enclosingRuntimeFunction(node);
        if (
          functionNode === null ||
          hasKnownOutputContract(functionNode, context.sourceCode.visitorKeys)
        ) {
          return;
        }
        for (const parameter of functionNode.params) {
          if (
            resolvedUnknownBindings(parameter).some((variable) =>
              directlyExposesParameter(argument, variable, context.sourceCode),
            )
          ) {
            report(parameter);
          }
        }
      },
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
    };
  },
});
