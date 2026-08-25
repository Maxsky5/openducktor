import { defineRule } from "@oxlint/plugins";

import {
  classifyUnsafeDictionary,
  classifyUnsafeInterfaceHeritage,
  classifyUnsafeDictionaryValue,
} from "../shared/dictionary-types.ts";
import { createLazyImportedTypeResolver } from "../shared/imported-type-resolution.ts";
import {
  createTypeEnvironment,
  isBuiltInType,
  type PortableTypeResolver,
} from "../shared/portable-type-resolution.ts";

import type { ESTree } from "@oxlint/plugins";

const typeNodeKinds: ReadonlySet<string> = new Set([
  "JSDocNonNullableType",
  "JSDocNullableType",
  "JSDocUnknownType",
  "TSAnyKeyword",
  "TSArrayType",
  "TSBigIntKeyword",
  "TSBooleanKeyword",
  "TSConditionalType",
  "TSConstructorType",
  "TSFunctionType",
  "TSImportType",
  "TSIndexedAccessType",
  "TSInferType",
  "TSIntersectionType",
  "TSIntrinsicKeyword",
  "TSLiteralType",
  "TSMappedType",
  "TSNamedTupleMember",
  "TSNeverKeyword",
  "TSNullKeyword",
  "TSNumberKeyword",
  "TSObjectKeyword",
  "TSParenthesizedType",
  "TSStringKeyword",
  "TSSymbolKeyword",
  "TSTemplateLiteralType",
  "TSThisType",
  "TSTupleType",
  "TSTypeLiteral",
  "TSTypeOperator",
  "TSTypePredicate",
  "TSTypeQuery",
  "TSTypeReference",
  "TSUndefinedKeyword",
  "TSUnionType",
  "TSUnknownKeyword",
  "TSVoidKeyword",
]);

function isTypeNode(node: ESTree.Node): node is ESTree.TSType {
  return typeNodeKinds.has(node.type);
}

function typeReferenceName(type: ESTree.TSTypeReference): string | null {
  return type.typeName.type === "Identifier" ? type.typeName.name : null;
}

function isInsideTypeAliasDeclaration(node: ESTree.Node): boolean {
  let current: ESTree.Node | null = node.parent;
  while (current !== null && current.type !== "Program") {
    if (current.type === "TSTypeAliasDeclaration") return true;
    current = current.parent;
  }
  return false;
}

function isPlainAliasConsumerUse(
  node: ESTree.TSType,
  environment: ReturnType<typeof createTypeEnvironment>,
): boolean {
  if (node.type !== "TSTypeReference" || node.typeArguments?.params.length) return false;
  const name = typeReferenceName(node);
  return name !== null && environment.aliases.has(name) && !isInsideTypeAliasDeclaration(node);
}

function isDictionaryTransformSource(
  node: ESTree.TSType,
  visitorKeys: Readonly<Record<string, readonly string[]>>,
): boolean {
  let current: ESTree.Node = node;
  while (current.parent !== null && current.parent.type !== "Program") {
    const parent: ESTree.Node = current.parent;
    if (parent.type === "TSTypeReference") {
      const name = typeReferenceName(parent);
      const source: ESTree.TSType | undefined = parent.typeArguments?.params[0];
      if (
        source !== undefined &&
        (name === "Pick" || name === "Omit") &&
        isBuiltInType(name, createTypeEnvironment(parent, visitorKeys))
      ) {
        let sourceAncestor: ESTree.Node | null = node;
        while (sourceAncestor !== null && sourceAncestor !== parent) {
          if (sourceAncestor === source) return true;
          sourceAncestor = sourceAncestor.parent;
        }
      }
    }
    current = parent;
  }
  return false;
}

function shouldReportType(
  node: ESTree.TSType,
  visitorKeys: Readonly<Record<string, readonly string[]>>,
  resolveImportedType: PortableTypeResolver,
): boolean {
  const environment = createTypeEnvironment(node, visitorKeys);
  if (isPlainAliasConsumerUse(node, environment)) return false;
  if (isDictionaryTransformSource(node, visitorKeys)) return false;
  if (classifyUnsafeDictionary(node, environment, resolveImportedType) === null) return false;
  let current: ESTree.Node | null = node.parent;
  while (current !== null && current.type !== "Program") {
    if (
      isTypeNode(current) &&
      classifyUnsafeDictionary(
        current,
        createTypeEnvironment(current, visitorKeys),
        resolveImportedType,
      ) !== null
    ) {
      return false;
    }
    current = current.parent;
  }
  return true;
}

/** Disallow object-dictionary contracts whose direct value type permits unchecked property use. */
export const noUnsafeDictionaryTypeRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow object-dictionary contracts whose direct value type is any, object, {}, or a union/alias containing one of those escape hatches. Unknown remains safe because callers must narrow every read.",
    },
    messages: {
      unsafeDictionary:
        "This dictionary's {{value}} value type permits unchecked property use. Use unknown for untrusted values or an owner/schema-derived value type for known values.",
    },
  },
  createOnce(context) {
    const importedTypeResolver = createLazyImportedTypeResolver(() => context.filename);

    const report = (node: ESTree.Node, value: string) => {
      context.report({ node, messageId: "unsafeDictionary", data: { value } });
    };
    const reportIfUnsafe = (node: ESTree.TSType) => {
      const visitorKeys = context.sourceCode.visitorKeys;
      const resolver = importedTypeResolver(node);
      if (!shouldReportType(node, visitorKeys, resolver)) return;
      const environment = createTypeEnvironment(node, visitorKeys);
      const unsafe = classifyUnsafeDictionary(node, environment, resolver);
      if (unsafe === null) return;
      report(node, unsafe.unsafeValue);
    };

    return {
      TSTypeReference: reportIfUnsafe,
      TSTypeLiteral: reportIfUnsafe,
      TSMappedType: reportIfUnsafe,
      TSInterfaceDeclaration(node) {
        const environment = createTypeEnvironment(node, context.sourceCode.visitorKeys);
        for (const heritage of node.extends) {
          const unsafe = classifyUnsafeInterfaceHeritage(
            heritage,
            environment,
            importedTypeResolver(heritage),
          );
          if (unsafe !== null) report(heritage, unsafe.unsafeValue);
        }
      },
      TSIndexSignature(node) {
        if (node.typeAnnotation === null || node.parent.type === "TSTypeLiteral") return;
        const environment = createTypeEnvironment(
          node.typeAnnotation.typeAnnotation,
          context.sourceCode.visitorKeys,
        );
        const unsafe = classifyUnsafeDictionaryValue(
          node.typeAnnotation.typeAnnotation,
          environment,
          importedTypeResolver(node),
        );
        if (unsafe !== null) report(node, unsafe.unsafeValue);
      },
    };
  },
});
