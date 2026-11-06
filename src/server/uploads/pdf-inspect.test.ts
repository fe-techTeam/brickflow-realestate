import { deflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildInvoiceDocument, DEMO_DATASETS, demoClock, SAMPLE_INVOICES } from "@/lib/demo/catalogue";
import { renderBrokerageInvoicePdf } from "@/lib/pdf/brokerage-invoice";
import { inspectPdf, maxPdfPagesFromEnv, scanParsedDocument, scanPdfStructure } from "./pdf-inspect";

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
    expect(maxPdfPagesFromEnv({ UPLOAD_MAX_PDF_PAGES: "7" })).toBe(7);
  });
});

const CATALOG = "<< /Type /Catalog /Pages 2 0 R >>";

function ascii85(data: Buffer): string {
  let out = "";
  for (let i = 0; i < data.length; i += 4) {
    const chunk = Buffer.concat([data.subarray(i, i + 4), Buffer.alloc(4)]).subarray(0, 4);
    let value = chunk.readUInt32BE(0);
    const digits: string[] = [];
    for (let k = 0; k < 5; k += 1) {
      digits.unshift(String.fromCharCode((value % 85) + 33));
      value = Math.floor(value / 85);
    }
    out += digits.slice(0, Math.min(4, data.length - i) + 1).join("");
  }
  return out;
}

describe("inspectPdf — parser differentials and fail-closed decoding", () => {
  it("does not skip a stream because of a decoy /Image key", () => {
    const decoyObjStm = handPdf([
      CATALOG,
      ...PAGE_TREE,
      stream("/Type /ObjStm /Image true /Subtype /Image /N 1 /First 4 /Filter /FlateDecode", deflateSync(Buffer.from("5 0 << /S /JavaScript /JS (x) >>", "latin1"))),
    ]);
    expect(scanPdfStructure(decoyObjStm)).toEqual({ reason: "active_content", detail: "/JavaScript" });

    const decoyContent = handPdf([CATALOG, ...PAGE_TREE, stream("/Image 1 /Length1 2 /Filter /FlateDecode", deflateSync(Buffer.from("/JavaScript", "latin1")))]);
    expect(scanPdfStructure(decoyContent)).toEqual({ reason: "active_content", detail: "/JavaScript" });
  });

  it("skips real image, cross-reference and font-file streams by their parsed values", () => {
    const bytes = handPdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      ...PAGE_TREE,
      stream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /Filter /DCTDecode", Buffer.from("\xff\xd8 /JS binary", "latin1")),
      "<< /Type /FontDescriptor /FontName /X /FontFile2 6 0 R >>",
      stream("/Length1 4", Buffer.from("/AA font program bytes", "latin1")),
    ]);
    expect(scanPdfStructure(bytes)).toBeNull();
  });

  it("finds JavaScript inside an object stream through the parsed object graph", async () => {
    const bytes = await pdfLibDocument((doc) => {
      const action = doc.context.register(doc.context.obj({ S: "JavaScript", JS: PDFString.of("app.alert(1)") }));
      doc.getPage(0).node.set(PDFName.of("Annots"), doc.context.obj([doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 10, 10], A: action })]));
    });
    const document = await PDFDocument.load(bytes);
    expect(scanParsedDocument(document)).toMatchObject({ reason: "active_content" });
    await expect(inspectPdf(bytes)).resolves.toMatchObject({ ok: false, reason: "active_content" });
  });

  it("rejects an /OpenAction action on the catalog", async () => {
    const bytes = handPdf(["<< /Type /Catalog /Pages 2 0 R /OpenAction 4 0 R >>", ...PAGE_TREE, "<< /S /Named /N /Print >>"]);
    await expect(inspectPdf(bytes)).resolves.toMatchObject({ ok: false, reason: "active_content", detail: "/OpenAction" });
  });

  it("allows web links but rejects other link schemes", async () => {
    const withUri = (uri: string) =>
      pdfLibDocument((doc) => {
        doc.getPage(0).node.set(
          PDFName.of("Annots"),
          doc.context.obj([doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 10, 10], A: doc.context.obj({ S: "URI", URI: PDFString.of(uri) }) })]),
        );
      });
    await expect(inspectPdf(await withUri("https://example.com/terms"))).resolves.toMatchObject({ ok: true });
    await expect(inspectPdf(await withUri("javascript:alert(1)"))).resolves.toMatchObject({ ok: false, reason: "active_content", detail: "/URI scheme" });
    await expect(inspectPdf(await withUri("file:///etc/passwd"))).resolves.toMatchObject({ ok: false, reason: "active_content" });
  });

  it("fails closed on a corrupt flate stream", () => {
    const bytes = handPdf([CATALOG, ...PAGE_TREE, stream("/Filter /FlateDecode", Buffer.from("definitely not zlib data", "latin1"))]);
    expect(scanPdfStructure(bytes)).toMatchObject({ reason: "unreadable", detail: "corrupt FlateDecode data" });
  });

  it("fails closed on filters and predictors it cannot reverse", () => {
    const lzw = handPdf([CATALOG, ...PAGE_TREE, stream("/Filter /LZWDecode", Buffer.from("x"))]);
    expect(scanPdfStructure(lzw)).toMatchObject({ reason: "unreadable", detail: "unsupported filter LZWDecode" });
    const crypt = handPdf([CATALOG, ...PAGE_TREE, stream("/Filter [/FlateDecode /Crypt]", deflateSync(Buffer.from("x")))]);
    expect(scanPdfStructure(crypt)).toMatchObject({ reason: "unreadable" });
    const tiff = handPdf([CATALOG, ...PAGE_TREE, stream("/Filter /FlateDecode /DecodeParms << /Predictor 2 >>", deflateSync(Buffer.from("x")))]);
    expect(scanPdfStructure(tiff)).toMatchObject({ reason: "unreadable", detail: "unsupported predictor 2" });
  });

  it("decodes ASCII hex, ASCII85, run-length and chained filters", () => {
    const payload = deflateSync(Buffer.from("5 0 << /S /Launch >>", "latin1"));
    const hex = `${payload.toString("hex")}>`;
    const chained = handPdf([CATALOG, ...PAGE_TREE, stream("/Type /ObjStm /N 1 /First 4 /Filter [/ASCIIHexDecode /FlateDecode]", Buffer.from(hex, "latin1"))]);
    expect(scanPdfStructure(chained)).toEqual({ reason: "active_content", detail: "/Launch" });

    const a85 = handPdf([CATALOG, ...PAGE_TREE, stream("/Filter /ASCII85Decode", Buffer.from(`${ascii85(Buffer.from("q /JS 1 0 obj", "latin1"))}~>`, "latin1"))]);
    expect(scanPdfStructure(a85)).toEqual({ reason: "active_content", detail: "/JS" });

    const runLength = Buffer.concat([Buffer.from([2]), Buffer.from("/AA", "latin1"), Buffer.from([128])]);
    const rl = handPdf([CATALOG, ...PAGE_TREE, stream("/Filter /RunLengthDecode", runLength)]);
    expect(scanPdfStructure(rl)).toEqual({ reason: "active_content", detail: "/AA" });
  });

  it("reverses PNG predictors before scanning", () => {
    const row = Buffer.from("/JavaScript", "latin1");
    const predicted = Buffer.concat([Buffer.from([0]), row]);
    const bytes = handPdf([
      CATALOG,
      ...PAGE_TREE,
      stream(`/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns ${row.length} >>`, deflateSync(predicted)),
    ]);
    expect(scanPdfStructure(bytes)).toEqual({ reason: "active_content", detail: "/JavaScript" });
  });

  it("rejects streams that expand beyond the decompression budget", () => {
    const bomb = deflateSync(Buffer.alloc(52 * 1024 * 1024));
    const bytes = handPdf([CATALOG, ...PAGE_TREE, stream("/Filter /FlateDecode", bomb)]);
    expect(scanPdfStructure(bytes)).toMatchObject({ reason: "unreadable", detail: "decoded content too large" });
  });

  it("accepts every sample invoice in both demo datasets", async () => {
    for (const dataset of Object.values(DEMO_DATASETS)) {
      for (const sample of dataset.samples(demoClock())) {
        const bytes = await renderBrokerageInvoicePdf(buildInvoiceDocument(sample, dataset));
        await expect(inspectPdf(bytes), sample.slug).resolves.toEqual({ ok: true, pageCount: 1 });
      }
    }
  });
});

describe("inspectPdf — environment", () => {
  it("falls back to the default page limit", () => {
    expect(maxPdfPagesFromEnv({})).toBe(50);
    expect(maxPdfPagesFromEnv({ UPLOAD_MAX_PDF_PAGES: "10" })).toBe(10);
    expect(maxPdfPagesFromEnv({ UPLOAD_MAX_PDF_PAGES: "-1" })).toBe(50);
  });
});
