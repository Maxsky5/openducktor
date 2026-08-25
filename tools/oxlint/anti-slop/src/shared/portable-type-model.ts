import type {
  PortableClass,
  PortableNode,
  PortableTSInterfaceDeclaration,
  PortableTSModuleDeclaration,
  PortableTSType,
  PortableTSTypeAliasDeclaration,
  PortableTSTypeName,
  PortableTSTypeReference,
} from "./portable-ast.ts";

export const BUILT_INS: ReadonlySet<string> = new Set([
  "Array",
  "Exclude",
  "NonNullable",
  "Omit",
  "Partial",
  "Pick",
  "Promise",
  "PromiseLike",
  "PropertyKey",
  "Readonly",
  "ReadonlyArray",
  "Record",
  "Required",
]);

export const TRANSPARENT_TYPE_WRAPPERS: ReadonlySet<string> = new Set([
  "Readonly",
  "Partial",
  "Required",
  "NonNullable",
]);

export type PortableTypeEnvironment = {
  readonly aliases: ReadonlyMap<string, PortableTSTypeAliasDeclaration>;
  readonly classes: ReadonlyMap<string, readonly PortableClass[]>;
  readonly declaredTypeNames: ReadonlySet<string>;
  readonly declaredValueNames: ReadonlySet<string>;
  readonly importedTypeNames: ReadonlySet<string>;
  readonly importedTypeQueryNames: ReadonlySet<string>;
  readonly importedValueNames: ReadonlySet<string>;
  readonly interfaces: ReadonlyMap<string, readonly PortableTSInterfaceDeclaration[]>;
  readonly namespaceValueNames: ReadonlySet<string>;
  readonly namespaces: ReadonlyMap<string, readonly PortableTSModuleDeclaration[]>;
  readonly shadowedBuiltIns: ReadonlySet<string>;
  readonly uniqueSymbolDeclarations: ReadonlyMap<string, UniqueSymbolDeclaration>;
  readonly valueBindings: ReadonlyMap<string, PortableValueBinding>;
  readonly visitorKeys: Readonly<Record<string, readonly string[]>>;
};

export type PortableValueProjectionSegment =
  | number
  | string
  | { readonly kind: "array-rest"; readonly offset: number };

export type PortableValueBinding =
  | {
      readonly declarationKind: Extract<PortableNode, { type: "VariableDeclaration" }>["kind"];
      readonly declarator: Extract<PortableNode, { type: "VariableDeclarator" }>;
      readonly kind: "variable";
    }
  | {
      readonly kind: "typed";
      readonly omittedProperties: ReadonlySet<string>;
      readonly propertyPath: readonly PortableValueProjectionSegment[];
      readonly type: PortableTSType;
    }
  | {
      readonly expression: NonNullable<
        Extract<PortableNode, { type: "VariableDeclarator" }>["init"]
      >;
      readonly kind: "projected";
      readonly omittedProperties: ReadonlySet<string>;
      readonly propertyPath: readonly PortableValueProjectionSegment[];
    };

export type ResolvedPortableValueBinding = {
  readonly binding: PortableValueBinding;
  readonly environment: PortableTypeEnvironment;
  readonly propertyPath: readonly string[];
  readonly resolveImportedType: PortableTypeResolver | undefined;
};

export type PortableTypeArgument = {
  readonly environment: PortableTypeEnvironment;
  readonly resolveImportedType: PortableTypeResolver | undefined;
  readonly substitutions: TypeSubstitutions;
  readonly type: PortableTSType;
};

export type ResolvedPortableType =
  | {
      readonly arguments: readonly PortableTypeArgument[];
      readonly declaration: PortableTSTypeAliasDeclaration;
      readonly environment: PortableTypeEnvironment;
      readonly key: string;
      readonly kind: "alias";
      readonly resolveImportedType: PortableTypeResolver | undefined;
    }
  | {
      readonly arguments: readonly PortableTypeArgument[];
      readonly declarations: readonly PortableTSInterfaceDeclaration[];
      readonly environment: PortableTypeEnvironment;
      readonly key: string;
      readonly kind: "interface";
      readonly name: string;
      readonly resolveImportedType: PortableTypeResolver | undefined;
    };

export type UniqueSymbolIdentity = string;

export type UniqueSymbolDeclaration =
  | { readonly end: number; readonly kind: "explicit" | "symbol-call"; readonly start: number }
  | { readonly kind: "reference"; readonly reference: UniqueSymbolReference };

export type UniqueSymbolReference =
  | {
      readonly kind: "import";
      readonly exportPath: readonly string[];
      readonly moduleSpecifier: string;
    }
  | { readonly kind: "name"; readonly parts: readonly string[] };

export type PortableTypeResolver = {
  readonly resolveType: (
    typeNameParts: readonly string[],
    arguments_: readonly PortableTypeArgument[],
  ) => ResolvedPortableType | null;
  readonly resolveValue: (
    reference: UniqueSymbolReference,
    environment: PortableTypeEnvironment,
  ) => ResolvedPortableValueBinding | null;
  readonly resolveUniqueSymbol: (
    reference: UniqueSymbolReference,
    environment: PortableTypeEnvironment,
  ) => UniqueSymbolIdentity | null;
};

export type TypeSubstitutions = ReadonlyMap<string, PortableTypeArgument>;

const environmentIds = new WeakMap<PortableTypeEnvironment, number>();
let nextEnvironmentId = 1;

export function localResolutionKey(
  environment: PortableTypeEnvironment,
  parts: readonly string[],
): string {
  let id = environmentIds.get(environment);
  if (id === undefined) {
    id = nextEnvironmentId;
    nextEnvironmentId += 1;
    environmentIds.set(environment, id);
  }
  return `local\0${id}\0${parts.join("\0")}`;
}

export function typeReferenceName(type: PortableTSTypeReference): string | null {
  return type.typeName.type === "Identifier" ? type.typeName.name : null;
}

export function typeNameParts(typeName: PortableTSTypeName): readonly string[] {
  if (typeName.type === "Identifier") return [typeName.name];
  if (typeName.type === "ThisExpression") return [];
  return [...typeNameParts(typeName.left), typeName.right.name];
}

export function typeQueryUniqueSymbolReference(
  expression: Extract<PortableTSType, { type: "TSTypeQuery" }>["exprName"],
): UniqueSymbolReference {
  if (expression.type !== "TSImportType") {
    return { kind: "name", parts: typeNameParts(expression) };
  }
  return {
    exportPath: expression.qualifier === null ? [] : typeNameParts(expression.qualifier),
    kind: "import",
    moduleSpecifier: expression.source.value,
  };
}

export function expressionTypeNameParts(expression: PortableNode): readonly string[] {
  if (expression.type === "Identifier") return [expression.name];
  if (
    expression.type !== "MemberExpression" ||
    expression.computed ||
    expression.property.type !== "Identifier"
  ) {
    return [];
  }
  const ownerParts = expressionTypeNameParts(expression.object);
  return ownerParts.length === 0 ? [] : [...ownerParts, expression.property.name];
}

export function isBuiltInType(name: string, environment: PortableTypeEnvironment): boolean {
  return BUILT_INS.has(name) && !environment.shadowedBuiltIns.has(name);
}

export function unwrapTransparentType(type: PortableTSType): PortableTSType {
  let current = type;
  while (
    current.type === "TSParenthesizedType" ||
    (current.type === "TSTypeOperator" && current.operator === "readonly")
  ) {
    current = current.typeAnnotation;
  }
  return current;
}

export function isUnappliedReferenceTo(type: PortableTSType, name: string): boolean {
  const unwrapped = unwrapTransparentType(type);
  return (
    unwrapped.type === "TSTypeReference" &&
    typeReferenceName(unwrapped) === name &&
    (unwrapped.typeArguments === null ||
      unwrapped.typeArguments === undefined ||
      unwrapped.typeArguments.params.length === 0)
  );
}
