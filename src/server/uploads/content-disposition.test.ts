import { describe, expect, it } from "vitest";
import { contentDisposition } from "./content-disposition";

describe("contentDisposition", () => {
  it("emits an ASCII filename and an RFC 5987 UTF-8 filename", () => {
    expect(contentDisposition("inline", "GFH-2026-001.pdf")).toBe(`inline; filename="GFH-2026-001.pdf"; filename*=UTF-8''GFH-2026-001.pdf`);
    expect(contentDisposition("attachment", "बिल 1.pdf")).toBe(`attachment; filename="___ 1.pdf"; filename*=UTF-8''%E0%A4%AC%E0%A4%BF%E0%A4%B2%201.pdf`);
  });

  it("strips quotes, separators and control characters that could break the header", () => {
    const header = contentDisposition("attachment", 'a"b\\c/d\r\nSet-Cookie: x=1.pdf');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toContain(`filename="abcdSet-Cookie: x=1.pdf"`);
    expect(contentDisposition("inline", '""')).toContain(`filename="invoice.pdf"`);
  });
});
