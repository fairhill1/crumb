export type OpenAPIInfo = {
  title: string;
  version: string;
  description?: string;
  [key: string]: unknown;
};

/** Any schema that can produce a JSON Schema object for OpenAPI. */
export type JsonSchemaProvider = { toJsonSchema(): Record<string, unknown> };

export type RouteOpenAPIMeta = {
  method: string;
  path: string;
  bodySchema: JsonSchemaProvider | null;
  querySchema: JsonSchemaProvider | null;
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  operationId?: string;
  response?: JsonSchemaProvider | Record<number, JsonSchemaProvider>;
};

function crumbPathToOpenAPI(path: string): string {
  return path.replace(/:([^/]+)/g, "{$1}");
}

function isWildcardPath(path: string): boolean {
  return path.endsWith("/*") || path === "*";
}

function extractPathParams(path: string): string[] {
  const params: string[] = [];
  for (const match of path.matchAll(/:([^/]+)/g)) {
    params.push(match[1]!);
  }
  return params;
}

const STATUS_DESCRIPTIONS: Record<number, string> = {
  200: "OK",
  201: "Created",
  204: "No Content",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  422: "Unprocessable Entity",
  500: "Internal Server Error",
};

export function buildOpenAPISpec(
  metas: RouteOpenAPIMeta[],
  info: OpenAPIInfo,
): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const meta of metas) {
    if (isWildcardPath(meta.path)) continue;
    const openApiPath = crumbPathToOpenAPI(meta.path);
    if (!paths[openApiPath]) paths[openApiPath] = {};

    const parameters: unknown[] = extractPathParams(meta.path).map((name) => ({
      name,
      in: "path",
      required: true,
      schema: { type: "string" },
    }));

    if (meta.querySchema) {
      const qs = meta.querySchema.toJsonSchema();
      if (qs.type === "object" && qs.properties) {
        const props = qs.properties as Record<string, unknown>;
        const required = (qs.required ?? []) as string[];
        for (const [name, schema] of Object.entries(props)) {
          parameters.push({ name, in: "query", required: required.includes(name), schema });
        }
      }
    }

    const operation: Record<string, unknown> = {};
    if (meta.summary) operation.summary = meta.summary;
    if (meta.description) operation.description = meta.description;
    if (meta.tags?.length) operation.tags = meta.tags;
    if (meta.deprecated) operation.deprecated = true;
    if (meta.operationId) operation.operationId = meta.operationId;
    if (parameters.length > 0) operation.parameters = parameters;

    if (meta.bodySchema) {
      operation.requestBody = {
        required: true,
        content: { "application/json": { schema: meta.bodySchema.toJsonSchema() } },
      };
    }

    const responses: Record<string, unknown> = {};
    if (meta.response && "toJsonSchema" in meta.response) {
      responses["200"] = {
        description: "OK",
        content: { "application/json": { schema: (meta.response as JsonSchemaProvider).toJsonSchema() } },
      };
    } else if (meta.response) {
      for (const [status, schema] of Object.entries(meta.response as Record<number, JsonSchemaProvider>)) {
        responses[status] = {
          description: STATUS_DESCRIPTIONS[Number(status)] ?? "Response",
          content: { "application/json": { schema: schema.toJsonSchema() } },
        };
      }
    } else {
      responses["200"] = { description: "OK" };
    }
    operation.responses = responses;

    paths[openApiPath]![meta.method.toLowerCase()] = operation;
  }

  return { openapi: "3.1.0", info, paths };
}
