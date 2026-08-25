import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode, Variable } from "@oxlint/plugins";

import {
  createTypeEnvironment,
  typeResolvesToAny,
  typeResolvesToUnknown,
} from "../shared/dictionary-types.ts";
import { createImportedTypeResolver } from "../shared/imported-type-resolution.ts";
import { unwrapTransparentExpression } from "../shared/transparent-expression.ts";
import { resolveVariable } from "../shared/global-reference.ts";
import { isStableBinding } from "../shared/stable-binding.ts";
import {
  typePropertyPathResolvesToUnknown,
  type TypePropertyPathSegment,
} from "../shared/type-property-path.ts";
import type { PortableTypeResolver } from "../shared/portable-type-resolution.ts";

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
  readonly path: readonly TypePropertyPathSegment[];
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

function bindingPropertyName(key: ESTree.Node, computed: boolean): string | null {
  if (!computed && key.type === "Identifier") return key.name;
  if (key.type === "Literal" && (typeof key.value === "string" || typeof key.value === "number")) {
    return String(key.value);
  }
  return null;
}

function parameterBindings(
  pattern: Parameter | ESTree.BindingPattern,
  path: readonly TypePropertyPathSegment[] = [],
): readonly ParameterBinding[] {
  if (pattern.type === "TSParameterProperty") {
    return parameterBindings(pattern.parameter, path);
  }
  if (pattern.type === "AssignmentPattern") {
    return parameterBindings(pattern.left, path);
  }
  if (pattern.type === "RestElement") return [];
  if (pattern.type === "Identifier") return [{ identifier: pattern, path }];
  if (pattern.type === "ObjectPattern") {
    return pattern.properties.flatMap((property): readonly ParameterBinding[] => {
      if (property.type === "RestElement") return [];
      const name = bindingPropertyName(property.key, property.computed);
      if (name === null) return [];
      return parameterBindings(property.value, [...path, name]);
    });
  }
  return pattern.elements.flatMap((element, index): readonly ParameterBinding[] => {
    if (element === null || element.type === "RestElement") return [];
    return parameterBindings(element, [...path, index]);
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
    let resolveImportedType: PortableTypeResolver | null = null;

    const importedTypeResolver = (node: ESTree.Node): PortableTypeResolver => {
      if (resolveImportedType !== null) return resolveImportedType;
      let root = node;
      while (root.parent !== null) root = root.parent;
      resolveImportedType = createImportedTypeResolver(
        context.filename,
        root.type === "Program" ? root.body : [],
      );
      return resolveImportedType;
    };

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
      const resolver = importedTypeResolver(annotation);
      return parameterBindings(parameter).flatMap(({ identifier, path }): readonly Variable[] => {
        if (
          !typePropertyPathResolvesToUnknown(annotation.typeAnnotation, path, environment, resolver)
        ) {
          return [];
        }
        const variable = resolveVariable(context.sourceCode, identifier);
        return variable === null ? [] : [variable];
      });
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
          hasKnownOutputContract(node, context.sourceCode.visitorKeys, importedTypeResolver(node))
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
