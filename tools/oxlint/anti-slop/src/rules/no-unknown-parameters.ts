import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode, Variable } from "@oxlint/plugins";

import { typeResolvesToAny, typeResolvesToUnknown } from "../shared/dictionary-types.ts";
import { createLazyImportedTypeResolver } from "../shared/imported-type-resolution.ts";
import { portablePropertyKeyValue } from "../shared/keyof-property-key-domain.ts";
import {
  createTypeEnvironment,
  expressionTypeNameParts,
  type PortableTypeResolver,
} from "../shared/portable-type-resolution.ts";
import { unwrapTransparentExpression } from "../shared/transparent-expression.ts";
import { resolveVariable } from "../shared/global-reference.ts";
import { isStableBinding } from "../shared/stable-binding.ts";
import {
  typePropertyPathResolvesToUnknown,
  type TypePropertyPathSegment,
} from "../shared/type-property-path.ts";

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
type ParameterBinding = {
  readonly identifier: ESTree.BindingIdentifier;
  readonly omittedProperties: ReadonlySet<string>;
  readonly path: readonly TypePropertyPathSegment[];
};
type ParameterExposure = {
  readonly exposesUnknownAtPath: (path: readonly TypePropertyPathSegment[]) => boolean;
  readonly variable: Variable;
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

function bindingPropertyPathSegment(
  key: ESTree.Node,
  computed: boolean,
): TypePropertyPathSegment | null {
  if (!computed && key.type === "Identifier") return key.name;
  if (key.type !== "Identifier") {
    const value = portablePropertyKeyValue(key);
    if (value !== null) return value;
  }
  const parts = expressionTypeNameParts(key);
  return computed && parts.length > 0 ? { kind: "name", parts } : null;
}

function parameterBindings(
  pattern: Parameter | ESTree.BindingPattern,
  path: readonly TypePropertyPathSegment[] = [],
  omittedProperties: ReadonlySet<string> = new Set(),
): readonly ParameterBinding[] {
  if (pattern.type === "TSParameterProperty") {
    return parameterBindings(pattern.parameter, path, omittedProperties);
  }
  if (pattern.type === "AssignmentPattern") {
    return parameterBindings(pattern.left, path, omittedProperties);
  }
  if (pattern.type === "RestElement") {
    return parameterBindings(pattern.argument, path, omittedProperties);
  }
  if (pattern.type === "Identifier") return [{ identifier: pattern, omittedProperties, path }];
  if (pattern.type === "ObjectPattern") {
    const omitted = new Set(
      pattern.properties.flatMap((property): readonly string[] => {
        if (property.type === "RestElement") return [];
        const segment = bindingPropertyPathSegment(property.key, property.computed);
        return typeof segment === "string" ? [segment] : [];
      }),
    );
    return pattern.properties.flatMap((property): readonly ParameterBinding[] => {
      if (property.type === "RestElement") {
        return parameterBindings(
          property.argument,
          path,
          new Set([...omittedProperties, ...omitted]),
        );
      }
      const segment = bindingPropertyPathSegment(property.key, property.computed);
      if (segment === null) return [];
      return parameterBindings(property.value, [...path, segment], omittedProperties);
    });
  }
  return pattern.elements.flatMap((element, index): readonly ParameterBinding[] => {
    if (element === null) return [];
    return element.type === "RestElement"
      ? parameterBindings(
          element.argument,
          [...path, { kind: "array-rest", offset: index }],
          omittedProperties,
        )
      : parameterBindings(element, [...path, index], omittedProperties);
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
  parameterExposure: ParameterExposure,
  sourceCode: SourceCode,
  resolvingAliases: ReadonlySet<Variable> = new Set(),
  accessPath: readonly TypePropertyPathSegment[] = [],
): boolean {
  const unwrapped = unwrapTransparentExpression(expression, { includeTypeAssertions: true });
  if (unwrapped !== expression) {
    return directlyExposesParameter(
      unwrapped,
      parameterExposure,
      sourceCode,
      resolvingAliases,
      accessPath,
    );
  }
  if (expression.type === "Identifier") {
    if (resolveVariable(sourceCode, expression) === parameterExposure.variable) {
      return parameterExposure.exposesUnknownAtPath(accessPath);
    }
    const alias = stableAliasInitializer(sourceCode, expression, resolvingAliases);
    if (alias === null) return false;
    const nextResolving = new Set(resolvingAliases);
    nextResolving.add(alias.variable);
    return alias.kind === "expression"
      ? directlyExposesParameter(
          alias.expression,
          parameterExposure,
          sourceCode,
          nextResolving,
          accessPath,
        )
      : alias.body.body.some((statement) =>
          statementReturnsParameter(
            statement,
            parameterExposure,
            sourceCode,
            nextResolving,
            accessPath,
          ),
        );
  }
  if (expression.type === "ChainExpression")
    return directlyExposesParameter(
      expression.expression,
      parameterExposure,
      sourceCode,
      resolvingAliases,
      accessPath,
    );
  if (expression.type === "ArrowFunctionExpression" || expression.type === "FunctionExpression") {
    if (expression.body === null) return false;
    return expression.body.type === "BlockStatement"
      ? expression.body.body.some((statement) =>
          statementReturnsParameter(
            statement,
            parameterExposure,
            sourceCode,
            resolvingAliases,
            accessPath,
          ),
        )
      : directlyExposesParameter(
          expression.body,
          parameterExposure,
          sourceCode,
          resolvingAliases,
          accessPath,
        );
  }
  if (expression.type === "AwaitExpression") {
    return directlyExposesParameter(
      expression.argument,
      parameterExposure,
      sourceCode,
      resolvingAliases,
      accessPath,
    );
  }
  if (expression.type === "ConditionalExpression") {
    return (
      directlyExposesParameter(
        expression.consequent,
        parameterExposure,
        sourceCode,
        resolvingAliases,
        accessPath,
      ) ||
      directlyExposesParameter(
        expression.alternate,
        parameterExposure,
        sourceCode,
        resolvingAliases,
        accessPath,
      )
    );
  }
  if (expression.type === "LogicalExpression") {
    return (
      directlyExposesParameter(
        expression.left,
        parameterExposure,
        sourceCode,
        resolvingAliases,
        accessPath,
      ) ||
      directlyExposesParameter(
        expression.right,
        parameterExposure,
        sourceCode,
        resolvingAliases,
        accessPath,
      )
    );
  }
  if (expression.type === "SequenceExpression") {
    const lastExpression = expression.expressions.at(-1);
    return (
      lastExpression !== undefined &&
      directlyExposesParameter(
        lastExpression,
        parameterExposure,
        sourceCode,
        resolvingAliases,
        accessPath,
      )
    );
  }
  if (expression.type === "MemberExpression" && expression.object.type !== "Super") {
    const segment = bindingPropertyPathSegment(expression.property, expression.computed);
    return directlyExposesParameter(
      expression.object,
      parameterExposure,
      sourceCode,
      resolvingAliases,
      segment === null ? accessPath : [segment, ...accessPath],
    );
  }
  if (expression.type === "ArrayExpression") {
    return expression.elements.some(
      (element) =>
        element !== null &&
        directlyExposesParameter(
          element.type === "SpreadElement" ? element.argument : element,
          parameterExposure,
          sourceCode,
          resolvingAliases,
          accessPath,
        ),
    );
  }
  if (expression.type === "ObjectExpression") {
    return expression.properties.some((property) =>
      directlyExposesParameter(
        property.type === "SpreadElement" ? property.argument : property.value,
        parameterExposure,
        sourceCode,
        resolvingAliases,
        accessPath,
      ),
    );
  }
  if (expression.type === "TemplateLiteral") {
    return expression.expressions.some((part) =>
      directlyExposesParameter(part, parameterExposure, sourceCode, resolvingAliases, accessPath),
    );
  }
  return false;
}

function statementReturnsParameter(
  statement: ESTree.Statement,
  parameterExposure: ParameterExposure,
  sourceCode: SourceCode,
  resolvingAliases: ReadonlySet<Variable> = new Set(),
  accessPath: readonly TypePropertyPathSegment[] = [],
): boolean {
  if (statement.type === "ReturnStatement") {
    return (
      statement.argument !== null &&
      directlyExposesParameter(
        statement.argument,
        parameterExposure,
        sourceCode,
        resolvingAliases,
        accessPath,
      )
    );
  }
  if (statement.type === "BlockStatement") {
    return statement.body.some((child) =>
      statementReturnsParameter(child, parameterExposure, sourceCode, resolvingAliases, accessPath),
    );
  }
  if (statement.type === "IfStatement") {
    return (
      statementReturnsParameter(
        statement.consequent,
        parameterExposure,
        sourceCode,
        resolvingAliases,
        accessPath,
      ) ||
      (statement.alternate !== null &&
        statementReturnsParameter(
          statement.alternate,
          parameterExposure,
          sourceCode,
          resolvingAliases,
          accessPath,
        ))
    );
  }
  if (statement.type === "SwitchStatement") {
    return statement.cases.some((case_) =>
      case_.consequent.some((child) =>
        statementReturnsParameter(
          child,
          parameterExposure,
          sourceCode,
          resolvingAliases,
          accessPath,
        ),
      ),
    );
  }
  if (statement.type === "TryStatement") {
    return (
      statementReturnsParameter(
        statement.block,
        parameterExposure,
        sourceCode,
        resolvingAliases,
        accessPath,
      ) ||
      (statement.handler !== null &&
        statementReturnsParameter(
          statement.handler.body,
          parameterExposure,
          sourceCode,
          resolvingAliases,
          accessPath,
        )) ||
      (statement.finalizer !== null &&
        statementReturnsParameter(
          statement.finalizer,
          parameterExposure,
          sourceCode,
          resolvingAliases,
          accessPath,
        ))
    );
  }
  return false;
}

function hasKnownOutputContract(
  functionNode: RuntimeFunction,
  visitorKeys: Readonly<Record<string, readonly string[]>>,
  resolveImportedType: PortableTypeResolver,
): boolean {
  const returnType = functionNode.returnType?.typeAnnotation;
  if (returnType === undefined) return false;
  const environment = createTypeEnvironment(returnType, visitorKeys);
  return (
    !typeResolvesToAny(returnType, environment, resolveImportedType) &&
    !typeResolvesToUnknown(returnType, environment, resolveImportedType)
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
    const importedTypeResolver = createLazyImportedTypeResolver(() => context.filename);

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

    const parameterExposures = (parameter: Parameter): readonly ParameterExposure[] => {
      const annotation = parameterAnnotation(parameter);
      if (annotation === null || annotation === undefined) return [];
      const environment = createTypeEnvironment(
        annotation.typeAnnotation,
        context.sourceCode.visitorKeys,
      );
      const resolver = importedTypeResolver(annotation);
      return parameterBindings(parameter).flatMap(
        ({ identifier, omittedProperties, path }): readonly ParameterExposure[] => {
          const variable = resolveVariable(context.sourceCode, identifier);
          if (variable === null) return [];
          const bindingIsUnknown = typePropertyPathResolvesToUnknown(
            annotation.typeAnnotation,
            path,
            environment,
            resolver,
          );
          return [
            {
              exposesUnknownAtPath(accessPath) {
                if (bindingIsUnknown) return true;
                const firstAccess = accessPath[0];
                if (typeof firstAccess === "string" && omittedProperties.has(firstAccess)) {
                  return false;
                }
                return (
                  accessPath.length > 0 &&
                  typePropertyPathResolvesToUnknown(
                    annotation.typeAnnotation,
                    [...path, ...accessPath],
                    environment,
                    resolver,
                  )
                );
              },
              variable,
            },
          ];
        },
      );
    };

    const checkAssertion = (node: ESTree.TSAsExpression | ESTree.TSTypeAssertion): void => {
      const functionNode = enclosingRuntimeFunction(node);
      if (functionNode === null) return;
      for (const parameter of functionNode.params) {
        if (
          parameterExposures(parameter).some((exposure) =>
            directlyExposesParameter(node.expression, exposure, context.sourceCode),
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
          hasKnownOutputContract(node, context.sourceCode.visitorKeys, importedTypeResolver(node))
        ) {
          return;
        }
        const body = node.body;
        for (const parameter of node.params) {
          if (
            parameterExposures(parameter).some((exposure) =>
              directlyExposesParameter(body, exposure, context.sourceCode),
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
          hasKnownOutputContract(
            functionNode,
            context.sourceCode.visitorKeys,
            importedTypeResolver(functionNode),
          )
        ) {
          return;
        }
        for (const parameter of functionNode.params) {
          if (
            parameterExposures(parameter).some((exposure) =>
              directlyExposesParameter(argument, exposure, context.sourceCode),
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
