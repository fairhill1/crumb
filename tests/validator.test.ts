import { describe, test, expect } from "bun:test";
import { v, ValidationError } from "../src/validator";
import type { Infer } from "../src/validator";

describe("Validator", () => {
  describe("StringSchema", () => {
    test("parses valid string", () => {
      expect(v.string().parse("hello")).toBe("hello");
    });

    test("rejects non-string", () => {
      expect(() => v.string().parse(42)).toThrow(ValidationError);
    });

    test("min check", () => {
      const schema = v.string().min(3);
      expect(schema.parse("abc")).toBe("abc");
      expect(() => schema.parse("ab")).toThrow(ValidationError);
    });

    test("max check", () => {
      const schema = v.string().max(5);
      expect(schema.parse("hello")).toBe("hello");
      expect(() => schema.parse("toolong")).toThrow(ValidationError);
    });

    test("pattern check", () => {
      const schema = v.string().pattern(/^\d+$/);
      expect(schema.parse("123")).toBe("123");
      expect(() => schema.parse("abc")).toThrow(ValidationError);
    });

    test("chained checks", () => {
      const schema = v.string().min(2).max(5).pattern(/^[a-z]+$/);
      expect(schema.parse("abc")).toBe("abc");
      expect(() => schema.parse("a")).toThrow(ValidationError);
      expect(() => schema.parse("abcdef")).toThrow(ValidationError);
      expect(() => schema.parse("AB")).toThrow(ValidationError);
    });
  });

  describe("NumberSchema", () => {
    test("parses valid number", () => {
      expect(v.number().parse(42)).toBe(42);
    });

    test("rejects non-number", () => {
      expect(() => v.number().parse("42")).toThrow(ValidationError);
    });

    test("rejects NaN", () => {
      expect(() => v.number().parse(NaN)).toThrow(ValidationError);
    });

    test("min check", () => {
      const schema = v.number().min(0);
      expect(schema.parse(0)).toBe(0);
      expect(() => schema.parse(-1)).toThrow(ValidationError);
    });

    test("max check", () => {
      const schema = v.number().max(100);
      expect(schema.parse(100)).toBe(100);
      expect(() => schema.parse(101)).toThrow(ValidationError);
    });

    test("integer check", () => {
      const schema = v.number().integer();
      expect(schema.parse(5)).toBe(5);
      expect(() => schema.parse(5.5)).toThrow(ValidationError);
    });

    test("chained checks", () => {
      const schema = v.number().min(1).max(10).integer();
      expect(schema.parse(5)).toBe(5);
      expect(() => schema.parse(0)).toThrow(ValidationError);
      expect(() => schema.parse(11)).toThrow(ValidationError);
      expect(() => schema.parse(5.5)).toThrow(ValidationError);
    });
  });

  describe("BooleanSchema", () => {
    test("parses true", () => {
      expect(v.boolean().parse(true)).toBe(true);
    });

    test("parses false", () => {
      expect(v.boolean().parse(false)).toBe(false);
    });

    test("rejects non-boolean", () => {
      expect(() => v.boolean().parse(1)).toThrow(ValidationError);
      expect(() => v.boolean().parse("true")).toThrow(ValidationError);
    });
  });

  describe("ArraySchema", () => {
    test("parses valid array", () => {
      expect(v.array(v.number()).parse([1, 2, 3])).toEqual([1, 2, 3]);
    });

    test("rejects non-array", () => {
      expect(() => v.array(v.string()).parse("not array")).toThrow(ValidationError);
    });

    test("validates each item", () => {
      expect(() => v.array(v.number()).parse([1, "two", 3])).toThrow(ValidationError);
    });

    test("min check", () => {
      const schema = v.array(v.string()).min(2);
      expect(schema.parse(["a", "b"])).toEqual(["a", "b"]);
      expect(() => schema.parse(["a"])).toThrow(ValidationError);
    });

    test("max check", () => {
      const schema = v.array(v.string()).max(2);
      expect(schema.parse(["a"])).toEqual(["a"]);
      expect(() => schema.parse(["a", "b", "c"])).toThrow(ValidationError);
    });

    test("collects all item issues", () => {
      try {
        v.array(v.number()).parse(["a", "b"]);
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect((err as ValidationError).issues).toHaveLength(2);
        expect((err as ValidationError).issues[0]!.path).toBe("[0]");
        expect((err as ValidationError).issues[1]!.path).toBe("[1]");
      }
    });

    test("empty array is valid", () => {
      expect(v.array(v.string()).parse([])).toEqual([]);
    });
  });

  describe("ObjectSchema", () => {
    test("parses valid object", () => {
      const schema = v.object({
        name: v.string(),
        age: v.number(),
      });
      expect(schema.parse({ name: "alice", age: 30 })).toEqual({
        name: "alice",
        age: 30,
      });
    });

    test("rejects non-object", () => {
      const schema = v.object({ name: v.string() });
      expect(() => schema.parse("not object")).toThrow(ValidationError);
      expect(() => schema.parse(null)).toThrow(ValidationError);
      expect(() => schema.parse([1, 2])).toThrow(ValidationError);
    });

    test("collects all field issues", () => {
      const schema = v.object({
        name: v.string(),
        age: v.number(),
      });
      try {
        schema.parse({ name: 123, age: "thirty" });
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const issues = (err as ValidationError).issues;
        expect(issues).toHaveLength(2);
        expect(issues[0]!.path).toBe("name");
        expect(issues[1]!.path).toBe("age");
      }
    });

    test("strips unknown keys", () => {
      const schema = v.object({ name: v.string() });
      const result = schema.parse({ name: "alice", extra: true });
      expect(result).toEqual({ name: "alice" });
    });
  });

  describe("optional()", () => {
    test("allows undefined", () => {
      expect(v.string().optional().parse(undefined)).toBeUndefined();
    });

    test("validates present value", () => {
      expect(v.string().optional().parse("hello")).toBe("hello");
    });

    test("rejects wrong type", () => {
      expect(() => v.string().optional().parse(42)).toThrow(ValidationError);
    });

    test("optional field in object", () => {
      const schema = v.object({
        name: v.string(),
        age: v.number().optional(),
      });
      expect(schema.parse({ name: "alice" })).toEqual({ name: "alice" });
      expect(schema.parse({ name: "alice", age: 30 })).toEqual({
        name: "alice",
        age: 30,
      });
    });
  });

  describe("nullable()", () => {
    test("allows null", () => {
      expect(v.string().nullable().parse(null)).toBeNull();
    });

    test("validates present value", () => {
      expect(v.string().nullable().parse("hello")).toBe("hello");
    });

    test("rejects wrong type", () => {
      expect(() => v.string().nullable().parse(42)).toThrow(ValidationError);
    });
  });

  describe("nested structures", () => {
    test("nested objects", () => {
      const schema = v.object({
        user: v.object({
          name: v.string(),
          address: v.object({
            city: v.string(),
          }),
        }),
      });
      expect(
        schema.parse({
          user: { name: "alice", address: { city: "NYC" } },
        }),
      ).toEqual({ user: { name: "alice", address: { city: "NYC" } } });
    });

    test("nested object path reporting", () => {
      const schema = v.object({
        address: v.object({
          city: v.string(),
        }),
      });
      try {
        schema.parse({ address: { city: 123 } });
      } catch (err) {
        expect((err as ValidationError).issues[0]!.path).toBe("address.city");
      }
    });

    test("array of objects with path reporting", () => {
      const schema = v.object({
        items: v.array(
          v.object({
            name: v.string(),
          }),
        ),
      });
      try {
        schema.parse({ items: [{ name: "ok" }, { name: 42 }] });
      } catch (err) {
        expect((err as ValidationError).issues[0]!.path).toBe("items[1].name");
      }
    });

    test("nested array of arrays", () => {
      const schema = v.array(v.array(v.number()));
      expect(schema.parse([[1, 2], [3]])).toEqual([[1, 2], [3]]);
    });
  });

  describe("ValidationError", () => {
    test("has name and message", () => {
      const err = new ValidationError([{ path: "name", message: "Expected string" }]);
      expect(err.name).toBe("ValidationError");
      expect(err.message).toContain("Expected string");
    });

    test("has issues array", () => {
      const err = new ValidationError([
        { path: "a", message: "err a" },
        { path: "b", message: "err b" },
      ]);
      expect(err.issues).toHaveLength(2);
      expect(err.issues[0]).toEqual({ path: "a", message: "err a" });
    });

    test("is instanceof Error", () => {
      const err = new ValidationError([]);
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe("custom messages", () => {
    test("custom message on string schema", () => {
      const schema = v.string().message("Name is required");
      try {
        schema.parse(42);
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect((err as ValidationError).issues[0]!.message).toBe("Name is required");
      }
    });

    test("custom message on number schema", () => {
      const schema = v.number().message("Must be a number");
      try {
        schema.parse("abc");
      } catch (err) {
        expect((err as ValidationError).issues[0]!.message).toBe("Must be a number");
      }
    });

    test("custom message on boolean schema", () => {
      const schema = v.boolean().message("Toggle required");
      try {
        schema.parse("yes");
      } catch (err) {
        expect((err as ValidationError).issues[0]!.message).toBe("Toggle required");
      }
    });

    test("custom message on enum schema", () => {
      const schema = v.enum(["a", "b"] as const).message("Pick a or b");
      try {
        schema.parse("c");
      } catch (err) {
        expect((err as ValidationError).issues[0]!.message).toBe("Pick a or b");
      }
    });

    test("default message when no custom message", () => {
      try {
        v.string().parse(42);
      } catch (err) {
        expect((err as ValidationError).issues[0]!.message).toBe("Expected string");
      }
    });
  });

  describe("transform", () => {
    test("transforms parsed value", () => {
      const schema = v.string().transform((s) => s.trim());
      expect(schema.parse("  hello  ")).toBe("hello");
    });

    test("transform changes type", () => {
      const schema = v.string().transform(Number);
      expect(schema.parse("42")).toBe(42);
    });

    test("validates before transforming", () => {
      const schema = v.number().transform((n) => n * 2);
      expect(() => schema.parse("not a number")).toThrow(ValidationError);
    });

    test("transform with object schema", () => {
      const schema = v
        .object({ name: v.string(), age: v.number() })
        .transform((obj) => ({ ...obj, name: obj.name.toUpperCase() }));
      expect(schema.parse({ name: "alice", age: 30 })).toEqual({
        name: "ALICE",
        age: 30,
      });
    });
  });

  describe("EnumSchema", () => {
    test("accepts valid enum value", () => {
      const schema = v.enum(["active", "inactive"] as const);
      expect(schema.parse("active")).toBe("active");
      expect(schema.parse("inactive")).toBe("inactive");
    });

    test("rejects invalid enum value", () => {
      const schema = v.enum(["active", "inactive"] as const);
      expect(() => schema.parse("unknown")).toThrow(ValidationError);
    });

    test("rejects non-string", () => {
      const schema = v.enum(["a", "b"] as const);
      expect(() => schema.parse(123)).toThrow(ValidationError);
    });

    test("error message lists valid values", () => {
      const schema = v.enum(["a", "b", "c"] as const);
      try {
        schema.parse("d");
      } catch (err) {
        expect((err as ValidationError).issues[0]!.message).toBe(
          "Expected one of: a, b, c",
        );
      }
    });
  });

  describe("LiteralSchema", () => {
    test("accepts matching string literal", () => {
      expect(v.literal("admin").parse("admin")).toBe("admin");
    });

    test("accepts matching number literal", () => {
      expect(v.literal(42).parse(42)).toBe(42);
    });

    test("accepts matching boolean literal", () => {
      expect(v.literal(true).parse(true)).toBe(true);
    });

    test("rejects non-matching value", () => {
      expect(() => v.literal("admin").parse("user")).toThrow(ValidationError);
    });

    test("rejects wrong type", () => {
      expect(() => v.literal(42).parse("42")).toThrow(ValidationError);
    });

    test("error message includes expected value", () => {
      try {
        v.literal("admin").parse("user");
      } catch (err) {
        expect((err as ValidationError).issues[0]!.message).toBe(
          'Expected literal "admin"',
        );
      }
    });
  });

  describe("UnionSchema", () => {
    test("accepts first matching type", () => {
      const schema = v.union([v.string(), v.number()] as const);
      expect(schema.parse("hello")).toBe("hello");
      expect(schema.parse(42)).toBe(42);
    });

    test("rejects when no type matches", () => {
      const schema = v.union([v.string(), v.number()] as const);
      expect(() => schema.parse(true)).toThrow(ValidationError);
    });

    test("union of literals (discriminated)", () => {
      const schema = v.union([v.literal("a"), v.literal("b")] as const);
      expect(schema.parse("a")).toBe("a");
      expect(schema.parse("b")).toBe("b");
      expect(() => schema.parse("c")).toThrow(ValidationError);
    });

    test("error message for union failure", () => {
      const schema = v.union([v.string(), v.number()] as const);
      try {
        schema.parse(true);
      } catch (err) {
        expect((err as ValidationError).issues[0]!.message).toBe(
          "Value does not match any type in the union",
        );
      }
    });
  });

  describe("RecordSchema", () => {
    test("parses valid record", () => {
      const schema = v.record(v.number());
      expect(schema.parse({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
    });

    test("rejects non-object", () => {
      expect(() => v.record(v.string()).parse("not object")).toThrow(ValidationError);
      expect(() => v.record(v.string()).parse(null)).toThrow(ValidationError);
      expect(() => v.record(v.string()).parse([1, 2])).toThrow(ValidationError);
    });

    test("validates each value", () => {
      const schema = v.record(v.number());
      expect(() => schema.parse({ a: 1, b: "two" })).toThrow(ValidationError);
    });

    test("collects all value issues", () => {
      const schema = v.record(v.number());
      try {
        schema.parse({ a: "x", b: "y" });
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const issues = (err as ValidationError).issues;
        expect(issues).toHaveLength(2);
        expect(issues[0]!.path).toBe("a");
        expect(issues[1]!.path).toBe("b");
      }
    });

    test("empty object is valid", () => {
      expect(v.record(v.string()).parse({})).toEqual({});
    });

    test("nested path reporting", () => {
      const schema = v.object({ scores: v.record(v.number()) });
      try {
        schema.parse({ scores: { math: "high" } });
      } catch (err) {
        expect((err as ValidationError).issues[0]!.path).toBe("scores.math");
      }
    });
  });

  describe("DateSchema", () => {
    test("parses valid date string", () => {
      const result = v.date().parse("2024-01-15");
      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toContain("2024-01-15");
    });

    test("parses ISO date string", () => {
      const result = v.date().parse("2024-01-15T10:30:00.000Z");
      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe("2024-01-15T10:30:00.000Z");
    });

    test("rejects non-string", () => {
      expect(() => v.date().parse(123)).toThrow(ValidationError);
    });

    test("rejects invalid date string", () => {
      expect(() => v.date().parse("not-a-date")).toThrow(ValidationError);
    });

    test("min constraint", () => {
      const schema = v.date().min(new Date("2024-01-01"));
      expect(schema.parse("2024-06-15")).toBeInstanceOf(Date);
      expect(() => schema.parse("2023-12-31")).toThrow(ValidationError);
    });

    test("max constraint", () => {
      const schema = v.date().max(new Date("2024-12-31"));
      expect(schema.parse("2024-06-15")).toBeInstanceOf(Date);
      expect(() => schema.parse("2025-01-01")).toThrow(ValidationError);
    });

    test("min and max together", () => {
      const schema = v.date().min(new Date("2024-01-01")).max(new Date("2024-12-31"));
      expect(schema.parse("2024-06-15")).toBeInstanceOf(Date);
      expect(() => schema.parse("2023-06-15")).toThrow(ValidationError);
      expect(() => schema.parse("2025-06-15")).toThrow(ValidationError);
    });
  });

  describe("CoercedStringSchema", () => {
    test("passes through strings unchanged", () => {
      expect(v.coerce.string().parse("hello")).toBe("hello");
    });

    test("coerces number to string", () => {
      expect(v.coerce.string().parse(42)).toBe("42");
    });

    test("coerces boolean to string", () => {
      expect(v.coerce.string().parse(true)).toBe("true");
      expect(v.coerce.string().parse(false)).toBe("false");
    });

    test("rejects non-coercible types", () => {
      expect(() => v.coerce.string().parse(null)).toThrow(ValidationError);
      expect(() => v.coerce.string().parse(undefined)).toThrow(ValidationError);
      expect(() => v.coerce.string().parse({})).toThrow(ValidationError);
    });

    test("chaining works after coercion", () => {
      const schema = v.coerce.string().min(2).max(5);
      expect(schema.parse(42)).toBe("42");
      expect(() => schema.parse(1)).toThrow(ValidationError); // "1" has length 1
      expect(() => schema.parse(123456)).toThrow(ValidationError); // "123456" too long
    });

    test("pattern works after coercion", () => {
      const schema = v.coerce.string().pattern(/^\d+$/);
      expect(schema.parse(123)).toBe("123");
      expect(() => schema.parse(true)).toThrow(ValidationError); // "true" doesn't match
    });

    test("optional wrapping works", () => {
      const schema = v.coerce.string().optional();
      expect(schema.parse(undefined)).toBeUndefined();
      expect(schema.parse(42)).toBe("42");
    });
  });

  describe("CoercedNumberSchema", () => {
    test("passes through numbers unchanged", () => {
      expect(v.coerce.number().parse(42)).toBe(42);
    });

    test("coerces string to number", () => {
      expect(v.coerce.number().parse("42")).toBe(42);
      expect(v.coerce.number().parse("3.14")).toBe(3.14);
      expect(v.coerce.number().parse("-10")).toBe(-10);
    });

    test("trims whitespace before coercing", () => {
      expect(v.coerce.number().parse("  42  ")).toBe(42);
    });

    test("rejects empty string", () => {
      expect(() => v.coerce.number().parse("")).toThrow(ValidationError);
      expect(() => v.coerce.number().parse("   ")).toThrow(ValidationError);
    });

    test("rejects NaN-producing strings", () => {
      expect(() => v.coerce.number().parse("abc")).toThrow(ValidationError);
      expect(() => v.coerce.number().parse("12abc")).toThrow(ValidationError);
    });

    test("rejects non-coercible types", () => {
      expect(() => v.coerce.number().parse(null)).toThrow(ValidationError);
      expect(() => v.coerce.number().parse(true)).toThrow(ValidationError);
    });

    test("chaining works after coercion", () => {
      const schema = v.coerce.number().min(1).max(100);
      expect(schema.parse("50")).toBe(50);
      expect(() => schema.parse("0")).toThrow(ValidationError);
      expect(() => schema.parse("101")).toThrow(ValidationError);
    });

    test("integer check works after coercion", () => {
      const schema = v.coerce.number().integer();
      expect(schema.parse("5")).toBe(5);
      expect(() => schema.parse("5.5")).toThrow(ValidationError);
    });

    test("optional wrapping works", () => {
      const schema = v.coerce.number().optional();
      expect(schema.parse(undefined)).toBeUndefined();
      expect(schema.parse("42")).toBe(42);
    });
  });

  describe("CoercedBooleanSchema", () => {
    test("passes through booleans unchanged", () => {
      expect(v.coerce.boolean().parse(true)).toBe(true);
      expect(v.coerce.boolean().parse(false)).toBe(false);
    });

    test("coerces truthy strings", () => {
      expect(v.coerce.boolean().parse("true")).toBe(true);
      expect(v.coerce.boolean().parse("1")).toBe(true);
      expect(v.coerce.boolean().parse("TRUE")).toBe(true);
      expect(v.coerce.boolean().parse("True")).toBe(true);
    });

    test("coerces falsy strings", () => {
      expect(v.coerce.boolean().parse("false")).toBe(false);
      expect(v.coerce.boolean().parse("0")).toBe(false);
      expect(v.coerce.boolean().parse("")).toBe(false);
      expect(v.coerce.boolean().parse("FALSE")).toBe(false);
    });

    test("rejects non-boolean strings", () => {
      expect(() => v.coerce.boolean().parse("yes")).toThrow(ValidationError);
      expect(() => v.coerce.boolean().parse("no")).toThrow(ValidationError);
      expect(() => v.coerce.boolean().parse("2")).toThrow(ValidationError);
    });

    test("rejects non-coercible types", () => {
      expect(() => v.coerce.boolean().parse(0)).toThrow(ValidationError);
      expect(() => v.coerce.boolean().parse(1)).toThrow(ValidationError);
      expect(() => v.coerce.boolean().parse(null)).toThrow(ValidationError);
    });

    test("optional wrapping works", () => {
      const schema = v.coerce.boolean().optional();
      expect(schema.parse(undefined)).toBeUndefined();
      expect(schema.parse("true")).toBe(true);
    });
  });

  describe("type inference", () => {
    test("Infer type works at type level", () => {
      const schema = v.object({
        name: v.string(),
        age: v.number().optional(),
        tags: v.array(v.string()),
        active: v.boolean(),
      });

      // This test verifies the type compiles — the assignment itself is the test
      type User = Infer<typeof schema>;
      const user: User = { name: "alice", tags: ["a"], active: true };
      expect(user.name).toBe("alice");
    });

    test("Infer works with new schema types", () => {
      const status = v.enum(["active", "inactive"] as const);
      type Status = Infer<typeof status>;
      const s: Status = "active";
      expect(s).toBe("active");

      const lit = v.literal("admin");
      type Lit = Infer<typeof lit>;
      const l: Lit = "admin";
      expect(l).toBe("admin");

      const union = v.union([v.string(), v.number()] as const);
      type Union = Infer<typeof union>;
      const u: Union = "hello";
      expect(u).toBe("hello");

      const rec = v.record(v.number());
      type Rec = Infer<typeof rec>;
      const r: Rec = { a: 1 };
      expect(r).toEqual({ a: 1 });

      const date = v.date();
      type DateType = Infer<typeof date>;
      const d: DateType = new Date();
      expect(d).toBeInstanceOf(Date);

      const transformed = v.string().transform((s) => s.length);
      type Transformed = Infer<typeof transformed>;
      const t: Transformed = 5;
      expect(t).toBe(5);
    });
  });
});
