import { deflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildInvoiceDocument, SAMPLE_INVOICES } from "@/lib/demo/catalogue";
import { renderBrokerageInvoicePdf } from "@/lib/pdf/brokerage-invoice";
import { inspectPdf, maxPdfPagesFromEnv, scanPdfStructure } from "./pdf-inspect";

/** Assembles a classic PDF (objects numbered from 1, cross-reference table with real offsets). */
function handPdf(objects: (string | Buffer)[], trailerExtra = ""): Uint8Array {
  const parts: Buffer[] = [Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets: number[] = [];
  let length = parts[0]!.length;
  objects.forEach((body, index) => {
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, "latin1"), typeof body === "string" ? Buffer.from(body, "latin1") : body, Buffer.from("\nendobj\n", "latin1")]);
    offsets.push(length);
    parts.push(chunk);
    length += chunk.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${length}\n%%EOF\n`, "latin1"));
  return new Uint8Array(Buffer.concat(parts));
}

const PAGE_TREE = ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>"];

function stream(dict: string, data: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, "latin1"), data, Buffer.from("\nendstream", "latin1")]);
}

async function pdfLibDocument(mutate?: (doc: PDFDocument) => void | Promise<void>, options: { useObjectStreams?: boolean } = {}) {
  const doc = await PDFDocument.create();
  doc.addPage();
  await mutate?.(doc);
  return doc.save({ useObjectStreams: options.useObjectStreams ?? true });
}

describe("inspectPdf — accepted documents", () => {
  it("accepts generated brokerage invoices and reports the page count", async () => {
    const bytes = await renderBrokerageInvoicePdf(buildInvoiceDocument(SAMPLE_INVOICES[0]!));
    await expect(inspectPdf(bytes)).resolves.toEqual({ ok: true, pageCount: 1 });
  });

  it("accepts plain PDFs written with and without object streams", async () => {
    await expect(inspectPdf(await pdfLibDocument())).resolves.toEqual({ ok: true, pageCount: 1 });
    await expect(inspectPdf(await pdfLibDocument(undefined, { useObjectStreams: false }))).resolves.toEqual({ ok: true, pageCount: 1 });
  });

  it("allows an open action that only selects the first page", async () => {
    const bytes = await pdfLibDocument((doc) => {
      doc.catalog.set(PDFName.of("OpenAction"), doc.context.obj([doc.getPage(0).ref, PDFName.of("Fit")]));
    });
    await expect(inspectPdf(bytes)).resolves.toMatchObject({ ok: true });
  });

  it("ignores suspicious words inside text strings and image data", () => {
    const bytes = handPdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      ...PAGE_TREE,
      "<< /Title (Notes about /JavaScript and /Launch \\) /OpenAction) >>",
      stream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceGray", Buffer.from("random /JS /OpenAction bytes", "latin1")),
    ]);
    expect(scanPdfStructure(bytes)).toBeNull();
  });
});

describe("inspectPdf — rejected documents", () => {
  it("rejects JavaScript open actions hidden in compressed object streams", async () => {
    const bytes = await pdfLibDocument((doc) => {
      doc.catalog.set(PDFName.of("OpenAction"), doc.context.obj({ Type: "Action", S: "JavaScript", JS: PDFString.of("app.alert(1)") }));
    });
    expect(Buffer.from(bytes).toString("latin1")).not.toContain("/OpenAction");
    await expect(inspectPdf(bytes)).resolves.toMatchObject({ ok: false, reason: "active_content", message: expect.stringMatching(/scripts, automatic actions or embedded files/) });
  });

  it("rejects uncompressed JavaScript and additional actions", async () => {
    const js = await pdfLibDocument((doc) => {
      doc.catalog.set(PDFName.of("Names"), doc.context.obj({ JavaScript: doc.context.obj({ Names: [PDFString.of("x"), doc.context.obj({ S: "JavaScript", JS: PDFString.of("1") })] }) }));
    }, { useObjectStreams: false });
    await expect(inspectPdf(js)).resolves.toMatchObject({ ok: false, reason: "active_content" });

    const aa = await pdfLibDocument((doc) => {
      doc.getPage(0).node.set(PDFName.of("AA"), doc.context.obj({}));
    });
    await expect(inspectPdf(aa)).resolves.toMatchObject({ ok: false, reason: "active_content", detail: "/AA" });
  });

  it("rejects embedded files", async () => {
    const bytes = await pdfLibDocument(async (doc) => {
      await doc.attach(Buffer.from("payload"), "payload.txt", { mimeType: "text/plain" });
    });
    await expect(inspectPdf(bytes)).resolves.toMatchObject({ ok: false, reason: "embedded_file" });
  });

  it("rejects encrypted documents", async () => {
    const bytes = handPdf(["<< /Type /Catalog /Pages 2 0 R >>", ...PAGE_TREE, "<< /Filter /Standard /V 2 /R 3 /Length 128 /P -3904 /O <00> /U <00> >>"], "/Encrypt 4 0 R /ID [<01> <01>] ");
    await expect(inspectPdf(bytes)).resolves.toMatchObject({ ok: false, reason: "encrypted", message: expect.stringMatching(/Password-protected or encrypted/) });
  });

  it("decodes escaped names before checking them", async () => {
    const bytes = handPdf(["<< /Type /Catalog /Pages 2 0 R /Names << /J#61va#53cript 4 0 R >> >>", ...PAGE_TREE, "<< /S /Named /N /Print >>"]);
    await expect(inspectPdf(bytes)).resolves.toMatchObject({ ok: false, reason: "active_content", detail: "/JavaScript" });
  });

  it("inflates hand-built object streams with obfuscated names", () => {
    const content = Buffer.from("5 0 << /S /Launch /F (calc.exe) >>", "latin1");
    const bytes = handPdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      ...PAGE_TREE,
      stream("/Type /Obj#53tm /N 1 /First 4 /Filter /FlateDecode", deflateSync(content)),
    ]);
    expect(scanPdfStructure(bytes)).toEqual({ reason: "active_content", detail: "/Launch" });
  });

  it("refuses object streams it cannot decode", () => {
    const bytes = handPdf(["<< /Type /Catalog /Pages 2 0 R >>", ...PAGE_TREE, stream("/Type /ObjStm /N 1 /First 4 /Filter /LZWDecode", Buffer.from("x"))]);
    expect(scanPdfStructure(bytes)).toMatchObject({ reason: "unreadable" });
  });

  it("rejects files that cannot be parsed or have no pages", async () => {
    await expect(inspectPdf(Buffer.from("%PDF-1.7\nthis is not really a pdf"))).resolves.toMatchObject({ ok: false });
    const empty = handPdf(["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [] /Count 0 >>"]);
    await expect(inspectPdf(empty)).resolves.toMatchObject({ ok: false, reason: "no_pages" });
  });

  it("limits the number of pages", async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 3; i += 1) doc.addPage();
    const bytes = await doc.save();
    await expect(inspectPdf(bytes, { maxPages: 2 })).resolves.toMatchObject({ ok: false, reason: "too_many_pages", message: expect.stringContaining("3 pages") });
    await expect(inspectPdf(bytes, { maxPages: 3 })).resolves.toEqual({ ok: true, pageCount: 3 });
  });

  it("reads the page limit from the environment", () => {
    expect(maxPdfPagesFromEnv({})).toBe(50);
    expect(maxPdfPagesFromEnv({ UPLOAD_MAX_PDF_PAGES: "10" })).toBe(10);
    expect(maxPdfPagesFromEnv({ UPLOAD_MAX_PDF_PAGES: "-1" })).toBe(50);
  });
});
