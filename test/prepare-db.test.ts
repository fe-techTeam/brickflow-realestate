import { describe, expect, it } from "vitest";
import { disposableDatabaseName } from "../scripts/prepare-db.mjs";

describe("disposableDatabaseName", () => {
  it("accepts test and e2e databases", () => {
    expect(disposableDatabaseName("postgresql://u:p@localhost:5432/brickflow_test")).toBe("brickflow_test");
    expect(disposableDatabaseName("postgres://u:p@db/brickflow_e2e?sslmode=disable")).toBe("brickflow_e2e");
  });

  it("refuses the development and other databases", () => {
    for (const url of [
      "postgresql://u:p@localhost:5432/brickflow",
      "postgresql://u:p@localhost:5432/postgres",
      "postgresql://u:p@localhost:5432/brickflow_test_old",
      'postgresql://u:p@localhost:5432/x"; DROP DATABASE brickflow; --_test',
    ]) {
      expect(() => disposableDatabaseName(url)).toThrow(/Refusing/);
    }
  });

  it("refuses non-PostgreSQL URLs", () => {
    expect(() => disposableDatabaseName("file:./prisma/test.db")).toThrow(/postgresql/);
    expect(() => disposableDatabaseName("not a url")).toThrow(/postgresql/);
  });
});
