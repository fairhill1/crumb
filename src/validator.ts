// ── Validation Issue & Error ──────────────────────────────────────────

export type ValidationIssue = { path: string; message: string };

export class ValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(`Validation failed: ${issues.map((i) => i.message).join(", ")}`);
    this.name = "ValidationError";
    this.issues = issues;
  }
}

// ── Abstract Schema Base ─────────────────────────────────────────────

export abstract class Schema<T> {
  /** Phantom field used by `Infer<S>` — never set at runtime. */
  declare readonly _output: T;

  protected _customMessage?: string;

  abstract parse(data: unknown, path?: string): T;
  abstract toJsonSchema(): Record<string, unknown>;

  message(msg: string): this {
    this._customMessage = msg;
    return this;
  }

  optional(): OptionalSchema<T> {
    return new OptionalSchema(this);
  }

  nullable(): NullableSchema<T> {
    return new NullableSchema(this);
  }

  transform<U>(fn: (val: T) => U): TransformSchema<T, U> {
    return new TransformSchema(this, fn);
  }

  protected fail(path: string, defaultMessage: string): never {
    throw new ValidationError([{ path, message: this._customMessage ?? defaultMessage }]);
  }
}

// ── Infer helper type ────────────────────────────────────────────────

export type Infer<S extends Schema<any>> = S["_output"];

// ── Optional / Nullable wrappers ─────────────────────────────────────

export class OptionalSchema<T> extends Schema<T | undefined> {
  constructor(private inner: Schema<T>) {
    super();
  }

  parse(data: unknown, path = ""): T | undefined {
    if (data === undefined) return undefined;
    return this.inner.parse(data, path);
  }

  toJsonSchema(): Record<string, unknown> {
    return this.inner.toJsonSchema();
  }
}

export class NullableSchema<T> extends Schema<T | null> {
  constructor(private inner: Schema<T>) {
    super();
  }

  parse(data: unknown, path = ""): T | null {
    if (data === null) return null;
    return this.inner.parse(data, path);
  }

  toJsonSchema(): Record<string, unknown> {
    return { oneOf: [this.inner.toJsonSchema(), { type: "null" }] };
  }
}

// ── Transform Schema ─────────────────────────────────────────────────

export class TransformSchema<TIn, TOut> extends Schema<TOut> {
  constructor(private inner: Schema<TIn>, private fn: (val: TIn) => TOut) {
    super();
  }

  parse(data: unknown, path = ""): TOut {
    return this.fn(this.inner.parse(data, path));
  }

  toJsonSchema(): Record<string, unknown> {
    return this.inner.toJsonSchema();
  }
}

// ── String Schema ────────────────────────────────────────────────────

type StringCheck =
  | { kind: "min"; value: number }
  | { kind: "max"; value: number }
  | { kind: "pattern"; value: RegExp };

export class StringSchema extends Schema<string> {
  private checks: StringCheck[] = [];

  min(n: number): this {
    this.checks.push({ kind: "min", value: n });
    return this;
  }

  max(n: number): this {
    this.checks.push({ kind: "max", value: n });
    return this;
  }

  pattern(re: RegExp): this {
    this.checks.push({ kind: "pattern", value: re });
    return this;
  }

  parse(data: unknown, path = ""): string {
    if (typeof data !== "string") {
      this.fail(path, "Expected string");
    }
    for (const check of this.checks) {
      if (check.kind === "min" && data.length < check.value) {
        throw new ValidationError([
          { path, message: `String must be at least ${check.value} characters` },
        ]);
      }
      if (check.kind === "max" && data.length > check.value) {
        throw new ValidationError([
          { path, message: `String must be at most ${check.value} characters` },
        ]);
      }
      if (check.kind === "pattern" && !check.value.test(data)) {
        throw new ValidationError([
          { path, message: `String must match pattern ${check.value}` },
        ]);
      }
    }
    return data;
  }

  toJsonSchema(): Record<string, unknown> {
    const schema: Record<string, unknown> = { type: "string" };
    for (const check of this.checks) {
      if (check.kind === "min") schema.minLength = check.value;
      if (check.kind === "max") schema.maxLength = check.value;
      if (check.kind === "pattern") schema.pattern = check.value.source;
    }
    return schema;
  }
}

// ── Number Schema ────────────────────────────────────────────────────

type NumberCheck =
  | { kind: "min"; value: number }
  | { kind: "max"; value: number }
  | { kind: "integer" };

export class NumberSchema extends Schema<number> {
  private checks: NumberCheck[] = [];

  min(n: number): this {
    this.checks.push({ kind: "min", value: n });
    return this;
  }

  max(n: number): this {
    this.checks.push({ kind: "max", value: n });
    return this;
  }

  integer(): this {
    this.checks.push({ kind: "integer" });
    return this;
  }

  parse(data: unknown, path = ""): number {
    if (typeof data !== "number" || Number.isNaN(data)) {
      this.fail(path, "Expected number");
    }
    for (const check of this.checks) {
      if (check.kind === "min" && data < check.value) {
        throw new ValidationError([
          { path, message: `Number must be at least ${check.value}` },
        ]);
      }
      if (check.kind === "max" && data > check.value) {
        throw new ValidationError([
          { path, message: `Number must be at most ${check.value}` },
        ]);
      }
      if (check.kind === "integer" && !Number.isInteger(data)) {
        throw new ValidationError([
          { path, message: "Number must be an integer" },
        ]);
      }
    }
    return data;
  }

  toJsonSchema(): Record<string, unknown> {
    const schema: Record<string, unknown> = { type: "number" };
    for (const check of this.checks) {
      if (check.kind === "min") schema.minimum = check.value;
      if (check.kind === "max") schema.maximum = check.value;
      if (check.kind === "integer") schema.type = "integer";
    }
    return schema;
  }
}

// ── Boolean Schema ───────────────────────────────────────────────────

export class BooleanSchema extends Schema<boolean> {
  parse(data: unknown, path = ""): boolean {
    if (typeof data !== "boolean") {
      this.fail(path, "Expected boolean");
    }
    return data;
  }

  toJsonSchema(): Record<string, unknown> {
    return { type: "boolean" };
  }
}

// ── Coerced Schemas ─────────────────────────────────────────────────

export class CoercedStringSchema extends StringSchema {
  override parse(data: unknown, path = ""): string {
    if (typeof data === "number" || typeof data === "boolean") {
      return super.parse(String(data), path);
    }
    return super.parse(data, path);
  }
}

export class CoercedNumberSchema extends NumberSchema {
  override parse(data: unknown, path = ""): number {
    if (typeof data === "string") {
      const trimmed = data.trim();
      if (trimmed === "") {
        this.fail(path, "Expected number");
      }
      const num = Number(trimmed);
      return super.parse(num, path);
    }
    return super.parse(data, path);
  }
}

export class CoercedBooleanSchema extends BooleanSchema {
  override parse(data: unknown, path = ""): boolean {
    if (typeof data === "string") {
      const lower = data.toLowerCase();
      if (lower === "true" || lower === "1") return true;
      if (lower === "false" || lower === "0" || lower === "") return false;
      this.fail(path, "Expected boolean");
    }
    return super.parse(data, path);
  }
}

// ── Array Schema ─────────────────────────────────────────────────────

type ArrayCheck = { kind: "min"; value: number } | { kind: "max"; value: number };

export class ArraySchema<T> extends Schema<T[]> {
  private checks: ArrayCheck[] = [];

  constructor(private item: Schema<T>) {
    super();
  }

  min(n: number): this {
    this.checks.push({ kind: "min", value: n });
    return this;
  }

  max(n: number): this {
    this.checks.push({ kind: "max", value: n });
    return this;
  }

  parse(data: unknown, path = ""): T[] {
    if (!Array.isArray(data)) {
      this.fail(path, "Expected array");
    }
    for (const check of this.checks) {
      if (check.kind === "min" && data.length < check.value) {
        throw new ValidationError([
          { path, message: `Array must have at least ${check.value} items` },
        ]);
      }
      if (check.kind === "max" && data.length > check.value) {
        throw new ValidationError([
          { path, message: `Array must have at most ${check.value} items` },
        ]);
      }
    }

    const issues: ValidationIssue[] = [];
    const result: T[] = [];

    for (let i = 0; i < data.length; i++) {
      try {
        result.push(this.item.parse(data[i], path ? `${path}[${i}]` : `[${i}]`));
      } catch (err) {
        if (err instanceof ValidationError) {
          issues.push(...err.issues);
        } else {
          throw err;
        }
      }
    }

    if (issues.length > 0) throw new ValidationError(issues);
    return result;
  }

  toJsonSchema(): Record<string, unknown> {
    const schema: Record<string, unknown> = { type: "array", items: this.item.toJsonSchema() };
    for (const check of this.checks) {
      if (check.kind === "min") schema.minItems = check.value;
      if (check.kind === "max") schema.maxItems = check.value;
    }
    return schema;
  }
}

// ── Object Schema ────────────────────────────────────────────────────

type ObjectShape = Record<string, Schema<any>>;

// Split required vs optional keys using the same technique as Zod:
// If undefined is assignable to the schema's output, the key is optional.
type OptionalKeys<T extends ObjectShape> = {
  [K in keyof T]: undefined extends T[K]["_output"] ? K : never;
}[keyof T];

type RequiredKeys<T extends ObjectShape> = {
  [K in keyof T]: undefined extends T[K]["_output"] ? never : K;
}[keyof T];

type InferObject<T extends ObjectShape> = {
  [K in RequiredKeys<T>]: T[K]["_output"];
} & {
  [K in OptionalKeys<T>]?: T[K]["_output"];
};

export class ObjectSchema<T extends ObjectShape> extends Schema<InferObject<T>> {
  constructor(private shape: T) {
    super();
  }

  parse(data: unknown, path = ""): InferObject<T> {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      this.fail(path, "Expected object");
    }

    const issues: ValidationIssue[] = [];
    const result: Record<string, unknown> = {};
    const obj = data as Record<string, unknown>;

    for (const key of Object.keys(this.shape)) {
      const fieldPath = path ? `${path}.${key}` : key;
      try {
        const value = this.shape[key]!.parse(obj[key], fieldPath);
        if (value !== undefined) {
          result[key] = value;
        }
      } catch (err) {
        if (err instanceof ValidationError) {
          issues.push(...err.issues);
        } else {
          throw err;
        }
      }
    }

    if (issues.length > 0) throw new ValidationError(issues);
    return result as InferObject<T>;
  }

  toJsonSchema(): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, fieldSchema] of Object.entries(this.shape)) {
      properties[key] = fieldSchema.toJsonSchema();
      if (!(fieldSchema instanceof OptionalSchema)) required.push(key);
    }
    const schema: Record<string, unknown> = { type: "object", properties };
    if (required.length > 0) schema.required = required;
    return schema;
  }
}

// ── Enum Schema ─────────────────────────────────────────────────────

export class EnumSchema<T extends readonly [string, ...string[]]> extends Schema<T[number]> {
  constructor(private values: T) {
    super();
  }

  parse(data: unknown, path = ""): T[number] {
    if (typeof data !== "string" || !(this.values as readonly string[]).includes(data)) {
      this.fail(path, `Expected one of: ${this.values.join(", ")}`);
    }
    return data as T[number];
  }

  toJsonSchema(): Record<string, unknown> {
    return { type: "string", enum: [...this.values] };
  }
}

// ── Literal Schema ──────────────────────────────────────────────────

export class LiteralSchema<T extends string | number | boolean> extends Schema<T> {
  constructor(private value: T) {
    super();
  }

  parse(data: unknown, path = ""): T {
    if (data !== this.value) {
      this.fail(path, `Expected literal ${JSON.stringify(this.value)}`);
    }
    return data as T;
  }

  toJsonSchema(): Record<string, unknown> {
    return { const: this.value };
  }
}

// ── Union Schema ────────────────────────────────────────────────────

export class UnionSchema<T extends readonly [Schema<any>, ...Schema<any>[]]> extends Schema<T[number]["_output"]> {
  constructor(private schemas: T) {
    super();
  }

  parse(data: unknown, path = ""): T[number]["_output"] {
    for (const schema of this.schemas) {
      try {
        return schema.parse(data, path);
      } catch {}
    }
    this.fail(path, "Value does not match any type in the union");
  }

  toJsonSchema(): Record<string, unknown> {
    return { oneOf: this.schemas.map((s) => s.toJsonSchema()) };
  }
}

// ── Record Schema ───────────────────────────────────────────────────

export class RecordSchema<T> extends Schema<Record<string, T>> {
  constructor(private valueSchema: Schema<T>) {
    super();
  }

  parse(data: unknown, path = ""): Record<string, T> {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      this.fail(path, "Expected object");
    }

    const issues: ValidationIssue[] = [];
    const result: Record<string, T> = {};

    for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
      try {
        result[key] = this.valueSchema.parse(val, path ? `${path}.${key}` : key);
      } catch (err) {
        if (err instanceof ValidationError) issues.push(...err.issues);
        else throw err;
      }
    }

    if (issues.length > 0) throw new ValidationError(issues);
    return result;
  }

  toJsonSchema(): Record<string, unknown> {
    return { type: "object", additionalProperties: this.valueSchema.toJsonSchema() };
  }
}

// ── Date Schema ─────────────────────────────────────────────────────

type DateCheck = { kind: "min"; value: Date } | { kind: "max"; value: Date };

export class DateSchema extends Schema<Date> {
  private checks: DateCheck[] = [];

  min(d: Date): this {
    this.checks.push({ kind: "min", value: d });
    return this;
  }

  max(d: Date): this {
    this.checks.push({ kind: "max", value: d });
    return this;
  }

  parse(data: unknown, path = ""): Date {
    if (typeof data !== "string") {
      this.fail(path, "Expected date string");
    }
    const date = new Date(data);
    if (isNaN(date.getTime())) {
      this.fail(path, "Invalid date");
    }
    for (const check of this.checks) {
      if (check.kind === "min" && date.getTime() < check.value.getTime()) {
        throw new ValidationError([
          { path, message: `Date must be on or after ${check.value.toISOString()}` },
        ]);
      }
      if (check.kind === "max" && date.getTime() > check.value.getTime()) {
        throw new ValidationError([
          { path, message: `Date must be on or before ${check.value.toISOString()}` },
        ]);
      }
    }
    return date;
  }

  toJsonSchema(): Record<string, unknown> {
    return { type: "string", format: "date-time" };
  }
}

// ── Namespace builder ────────────────────────────────────────────────

export const v = {
  string: () => new StringSchema(),
  number: () => new NumberSchema(),
  boolean: () => new BooleanSchema(),
  array: <T>(item: Schema<T>) => new ArraySchema(item),
  object: <T extends ObjectShape>(shape: T) => new ObjectSchema(shape),
  enum: <T extends readonly [string, ...string[]]>(values: T) => new EnumSchema(values),
  literal: <T extends string | number | boolean>(value: T) => new LiteralSchema(value),
  union: <T extends readonly [Schema<any>, ...Schema<any>[]]>(schemas: T) => new UnionSchema(schemas),
  record: <T>(valueSchema: Schema<T>) => new RecordSchema(valueSchema),
  date: () => new DateSchema(),
  coerce: {
    string: () => new CoercedStringSchema(),
    number: () => new CoercedNumberSchema(),
    boolean: () => new CoercedBooleanSchema(),
  },
};
