import { deflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFString, type PDFRef } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildInvoiceDocument, DEMO_DATASETS, demoClock, SAMPLE_INVOICES } from "@/lib/demo/catalogue";
import { renderBrokerageInvoicePdf } from "@/lib/pdf/brokerage-invoice";
import { inspectPdf, MAX_GRAPH_NODES, maxPdfPagesFromEnv, scanParsedDocument, scanPdfStructure } from "./pdf-inspect";

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
      stream("/Type /ObjStm /Image true /N 1 /First 4 /Filter /FlateDecode", deflateSync(Buffer.from("5 0 << /S /JavaScript /JS (x) >>", "latin1"))),
    ]);
    expect(scanPdfStructure(decoyObjStm)).toEqual({ reason: "active_content", detail: "/JavaScript" });

    const imageObjStm = handPdf([
      CATALOG,
      ...PAGE_TREE,
      stream("/Type /ObjStm /Subtype /Image /N 1 /First 4 /Filter /FlateDecode", deflateSync(Buffer.from("5 0 << /S /JavaScript /JS (x) >>", "latin1"))),
    ]);
    expect(scanPdfStructure(imageObjStm)).toEqual({ reason: "unreadable", detail: "object stream marked as an image" });

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
      stream(`/Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns ${row.length} >>`, deflateSync(predicted)),
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

/** Appends an incremental update (new object definitions, xref and trailer) to a document. */
function incrementalUpdate(base: Uint8Array, objects: [number, string][]): Uint8Array {
  const body = objects.map(([num, value]) => `${num} 0 obj\n${value}\nendobj\n`).join("");
  return new Uint8Array(Buffer.concat([Buffer.from(base), Buffer.from(`${body}xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 9 /Root 1 0 R >>\nstartxref\n0\n%%EOF\n`, "latin1")]));
}

describe("inspectPdf — decompression amplification", () => {
  it("stops run-length output at the budget instead of after decoding", () => {
    const runs = Buffer.alloc(2 * 420_000);
    for (let i = 0; i < runs.length; i += 2) runs[i] = 129;
    const bytes = handPdf([CATALOG, ...PAGE_TREE, stream("/Filter /RunLengthDecode", runs)]);
    expect(scanPdfStructure(bytes)).toEqual({ reason: "unreadable", detail: "decoded content too large" });
  });

  it("stops ASCII85 zero groups at the budget", () => {
    const zeros = Buffer.from(`${"z".repeat(13_200_000)}~>`, "latin1");
    const bytes = handPdf([CATALOG, ...PAGE_TREE, stream("/Filter /ASCII85Decode", zeros)]);
    expect(scanPdfStructure(bytes)).toEqual({ reason: "unreadable", detail: "decoded content too large" });
  });

  it("caps decoded bytes across the whole document, not per stream", () => {
    const chunk = deflateSync(Buffer.alloc(30 * 1024 * 1024));
    const one = handPdf([CATALOG, ...PAGE_TREE, stream("/Filter /FlateDecode", chunk)]);
    expect(scanPdfStructure(one)).toBeNull();
    const two = handPdf([CATALOG, ...PAGE_TREE, stream("/Filter /FlateDecode", chunk), stream("/Filter /FlateDecode", chunk)]);
    expect(scanPdfStructure(two)).toEqual({ reason: "unreadable", detail: "decoded content too large" });
  });
});

describe("inspectPdf — stream attribution", () => {
  it("is not fooled by an object header inside a string", () => {
    const bytes = handPdf([
      CATALOG,
      ...PAGE_TREE,
      stream("/Note (9 0 obj << /Subtype /Image >>) /Filter /FlateDecode", deflateSync(Buffer.from("/JavaScript", "latin1"))),
    ]);
    expect(scanPdfStructure(bytes)).toEqual({ reason: "active_content", detail: "/JavaScript" });
  });

  it("is not fooled by an object header inside a comment", () => {
    const body = Buffer.from("/Launch", "latin1");
    const spoof = Buffer.concat([Buffer.from(`<< /Length ${body.length} % 9 0 obj << /Subtype /Image\n>>\nstream\n`, "latin1"), body, Buffer.from("\nendstream", "latin1")]);
    expect(scanPdfStructure(handPdf([CATALOG, ...PAGE_TREE, spoof]))).toEqual({ reason: "active_content", detail: "/Launch" });
  });

  it("delimits streams by /Length and fails closed when it does not match", () => {
    const data = Buffer.from("q 1 0 0 1 0 0 cm Q", "latin1");
    const wrong = Buffer.concat([Buffer.from(`<< /Length ${data.length - 4} >>\nstream\n`, "latin1"), data, Buffer.from("\nendstream", "latin1")]);
    expect(scanPdfStructure(handPdf([CATALOG, ...PAGE_TREE, wrong]))).toMatchObject({ reason: "unreadable", detail: "stream /Length does not match endstream" });

    const indirect = Buffer.concat([Buffer.from("<< /Length 5 0 R >>\nstream\n", "latin1"), data, Buffer.from("\nendstream", "latin1")]);
    expect(scanPdfStructure(handPdf([CATALOG, ...PAGE_TREE, indirect, String(data.length)]))).toBeNull();
    expect(scanPdfStructure(handPdf([CATALOG, ...PAGE_TREE, indirect, String(data.length - 3)]))).toMatchObject({ reason: "unreadable" });
    expect(scanPdfStructure(handPdf([CATALOG, ...PAGE_TREE, indirect]))).toMatchObject({ reason: "unreadable", detail: "unresolvable stream /Length" });
  });

  it("fails closed on a stream keyword without a dictionary", () => {
    const orphan = handPdf([CATALOG, ...PAGE_TREE, "(not a dictionary)\nstream\n/JS\nendstream"]);
    expect(scanPdfStructure(orphan)).toMatchObject({ reason: "unreadable", detail: "stream without a dictionary" });
    const stray = new Uint8Array(Buffer.concat([Buffer.from(handPdf([CATALOG, ...PAGE_TREE])), Buffer.from("stream\n/JS\nendstream\n", "latin1")]));
    expect(scanPdfStructure(stray)).toMatchObject({ reason: "unreadable", detail: "stream keyword outside an object" });
  });

  it("rejects an object defined twice in one revision and checks every incremental revision", () => {
    const twice = handPdf([CATALOG, ...PAGE_TREE, "<< /Kind /First >>\nendobj\n4 0 obj\n<< /Kind /Second >>"]);
    expect(scanPdfStructure(twice)).toMatchObject({ reason: "unreadable", detail: "object 4 defined twice" });

    const base = handPdf([CATALOG, ...PAGE_TREE, "<< /S /JavaScript /JS (app.alert(1)) >>"]);
    const superseded = incrementalUpdate(base, [[4, "<< /S /Named /N /Print >>"]]);
    expect(scanPdfStructure(superseded)).toEqual({ reason: "active_content", detail: "/JavaScript" });

    const clean = incrementalUpdate(handPdf([CATALOG, ...PAGE_TREE, "<< /S /Named /N /Print >>"]), [[4, "<< /S /Named /N /NextPage >>"]]);
    expect(scanPdfStructure(clean)).toBeNull();
  });

  it("rejects duplicate keys that parsers could read differently", () => {
    const bytes = handPdf([CATALOG, ...PAGE_TREE, stream("/Subtype /Image /Subtype /Form", Buffer.from("/JS", "latin1"))]);
    expect(scanPdfStructure(bytes)).toMatchObject({ reason: "unreadable", detail: "duplicate /Subtype" });
  });
});

describe("inspectPdf — resolved action values", () => {
  async function withLink(build: (doc: PDFDocument) => Record<string, unknown>) {
    return pdfLibDocument((doc) => {
      doc.getPage(0).node.set(PDFName.of("Annots"), doc.context.obj([doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 10, 10], A: doc.context.obj(build(doc) as never) })]));
    });
  }

  it("resolves an indirect /URI before checking its scheme", async () => {
    const bad = await withLink((doc) => ({ S: "URI", URI: doc.context.register(PDFString.of("javascript:alert(1)")) }));
    await expect(inspectPdf(bad)).resolves.toMatchObject({ ok: false, reason: "active_content", detail: "/URI scheme" });
    const good = await withLink((doc) => ({ S: "URI", URI: doc.context.register(PDFString.of("https://example.com")) }));
    await expect(inspectPdf(good)).resolves.toMatchObject({ ok: true });
  });

  it("fails closed when /URI is not a string", async () => {
    const numeric = await withLink((doc) => ({ S: "URI", URI: doc.context.obj(42) }));
    await expect(inspectPdf(numeric)).resolves.toMatchObject({ ok: false, reason: "active_content", detail: "/URI scheme" });
    const missing = await withLink(() => ({ S: "URI" }));
    await expect(inspectPdf(missing)).resolves.toMatchObject({ ok: false, reason: "active_content" });
  });

  it("resolves an indirect action type and allows only navigation, links and named commands", async () => {
    const document = await PDFDocument.load(
      await withLink((doc) => ({ S: doc.context.register(PDFName.of("JavaScript")), JS: PDFString.of("x") })),
    );
    expect(scanParsedDocument(document)).toMatchObject({ reason: "active_content" });

    const resetForm = await PDFDocument.load(await withLink(() => ({ S: "ResetForm" })));
    expect(scanParsedDocument(resetForm)).toEqual({ reason: "active_content", detail: "action ResetForm" });

    const named = await withLink(() => ({ S: "Named", N: "NextPage" }));
    await expect(inspectPdf(named)).resolves.toMatchObject({ ok: true });
  });

  it("checks chained actions", async () => {
    const chained = await PDFDocument.load(await withLink((doc) => ({ S: "GoTo", D: [doc.getPage(0).ref, "Fit"], Next: doc.context.obj({ S: "ResetForm" }) })));
    expect(scanParsedDocument(chained)).toEqual({ reason: "active_content", detail: "action ResetForm" });
  });
});

describe("inspectPdf — traversal limits", () => {
  function linkTo(doc: PDFDocument, action: PDFRef) {
    return doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 10, 10], A: action });
  }

  it("fails closed on a cycle through /Next", async () => {
    const bytes = await pdfLibDocument((doc) => {
      const first = doc.context.nextRef();
      const second = doc.context.nextRef();
      const destination = [doc.getPage(0).ref, PDFName.of("Fit")];
      doc.context.assign(first, doc.context.obj({ S: "GoTo", D: destination, Next: second }));
      doc.context.assign(second, doc.context.obj({ S: "GoTo", D: destination, Next: first }));
      doc.getPage(0).node.set(PDFName.of("Annots"), doc.context.obj([linkTo(doc, first)]));
    });
    expect(scanParsedDocument(await PDFDocument.load(bytes))).toEqual({ reason: "unreadable", detail: "cycle in action chain" });
    await expect(inspectPdf(bytes)).resolves.toMatchObject({ ok: false, reason: "unreadable" });
  });

  it("fails closed on a self-referencing /Next array", async () => {
    const bytes = await pdfLibDocument((doc) => {
      const list = doc.context.nextRef();
      doc.context.assign(list, doc.context.obj([list]));
      const action = doc.context.register(doc.context.obj({ S: "GoTo", D: [doc.getPage(0).ref, PDFName.of("Fit")], Next: list }));
      doc.getPage(0).node.set(PDFName.of("Annots"), doc.context.obj([linkTo(doc, action)]));
    });
    expect(scanParsedDocument(await PDFDocument.load(bytes))).toEqual({ reason: "unreadable", detail: "cycle in action chain" });
  });

  it("checks a shared action list once however many links use it", async () => {
    const bytes = await pdfLibDocument((doc) => {
      const destination = [doc.getPage(0).ref, PDFName.of("Fit")];
      const actions = Array.from({ length: 2000 }, () => doc.context.register(doc.context.obj({ S: "GoTo", D: destination })));
      const list = doc.context.register(doc.context.obj(actions));
      const annots = Array.from({ length: 2000 }, () => doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 1, 1], A: doc.context.obj({ S: "GoTo", D: destination, Next: list }) }));
      doc.getPage(0).node.set(PDFName.of("Annots"), doc.context.obj(annots));
    });
    expect(scanParsedDocument(await PDFDocument.load(bytes))).toBeNull();
  });

  it("caps the total work on the object graph", async () => {
    const bytes = await pdfLibDocument((doc) => {
      doc.catalog.set(PDFName.of("Filler"), doc.context.obj(Array.from({ length: MAX_GRAPH_NODES + 10 }, (_, i) => i % 7)));
    });
    expect(scanParsedDocument(await PDFDocument.load(bytes))).toEqual({ reason: "unreadable", detail: "object graph too large" });
  });
});

describe("inspectPdf — tokenizer robustness", () => {
  it("skips long runs of stray delimiters in content without recursion", () => {
    const content = Buffer.from(`${")".repeat(1_000_000)}${">".repeat(1_000_000)} /JS`, "latin1");
    const bytes = handPdf([CATALOG, ...PAGE_TREE, stream("", content)]);
    expect(scanPdfStructure(bytes)).toEqual({ reason: "active_content", detail: "/JS" });
  });

  it("fails closed on stray delimiters in the file structure", () => {
    const bytes = handPdf([CATALOG, ...PAGE_TREE, "<< /Kind /Note >> )))"]);
    expect(scanPdfStructure(bytes)).toMatchObject({ reason: "unreadable", detail: "stray )" });
  });

  it("fails closed on deeply nested dictionaries and arrays", async () => {
    const dicts = handPdf([CATALOG, ...PAGE_TREE, `${"<< /A ".repeat(50_000)}1${" >>".repeat(50_000)}`]);
    expect(scanPdfStructure(dicts)).toEqual({ reason: "unreadable", detail: "nesting too deep" });
    const arrays = handPdf([CATALOG, ...PAGE_TREE, `${"[".repeat(200_000)}${"]".repeat(200_000)}`]);
    expect(scanPdfStructure(arrays)).toEqual({ reason: "unreadable", detail: "nesting too deep" });
    await expect(inspectPdf(arrays)).resolves.toMatchObject({ ok: false, reason: "unreadable" });
  });
});

describe("inspectPdf — object stream candidates", () => {
  const payload = deflateSync(Buffer.from("5 0 << /S /JavaScript /JS (x) >>", "latin1"));

  it("scans streams with /N and /First as object streams and rejects image markers on them", () => {
    const untyped = handPdf([CATALOG, ...PAGE_TREE, stream("/N 1 /First 4 /Filter /FlateDecode", payload)]);
    expect(scanPdfStructure(untyped)).toEqual({ reason: "active_content", detail: "/JavaScript" });

    const image = handPdf([CATALOG, ...PAGE_TREE, stream("/Subtype /Image /N 1 /First 4 /Filter /FlateDecode", payload)]);
    expect(scanPdfStructure(image)).toEqual({ reason: "unreadable", detail: "object stream marked as an image" });

    const codec = handPdf([CATALOG, ...PAGE_TREE, stream("/N 1 /First 4 /Filter [/FlateDecode /DCTDecode]", payload)]);
    expect(scanPdfStructure(codec)).toEqual({ reason: "unreadable", detail: "object stream marked as an image" });
  });

  it("treats type-2 containers in a cross-reference stream as object streams", () => {
    const rows = Buffer.from([0, 0, 255, 1, 0, 0, 1, 0, 0, 2, 4, 0, 1, 0, 0]);
    const bytes = handPdf([
      CATALOG,
      ...PAGE_TREE,
      stream("/Subtype /Image /Width 1 /Height 1 /Filter /FlateDecode", payload),
      stream("/Type /XRef /W [1 1 1] /Size 5", rows),
    ]);
    expect(scanPdfStructure(bytes)).toEqual({ reason: "unreadable", detail: "object stream marked as an image" });
  });

  it("bounds cross-reference streams before reading their rows", () => {
    const xref = (dict: string, data: Buffer) => handPdf([CATALOG, ...PAGE_TREE, stream(dict, data)]);
    const started = Date.now();

    expect(scanPdfStructure(xref("/Type /XRef /W [1 1 1] /Size 2000000000", Buffer.from([1, 0, 0])))).toEqual({
      reason: "unreadable",
      detail: "cross-reference stream too large",
    });
    expect(scanPdfStructure(xref("/Type /XRef /W [1 1 1] /Size 4 /Index [0 900000 900000 900000]", Buffer.from([1, 0, 0])))).toEqual({
      reason: "unreadable",
      detail: "cross-reference stream too large",
    });
    expect(scanPdfStructure(xref("/Type /XRef /W [1 9 1] /Size 1", Buffer.from([1, 0, 0])))).toEqual({ reason: "unreadable", detail: "cross-reference stream /W" });
    expect(scanPdfStructure(xref("/Type /XRef /W [0 0 0] /Size 1", Buffer.from([])))).toEqual({ reason: "unreadable", detail: "cross-reference stream /W" });
    expect(scanPdfStructure(xref("/Type /XRef /W [1 1 1] /Size 900000", Buffer.from([1, 0, 0])))).toEqual({
      reason: "unreadable",
      detail: "cross-reference stream is shorter than its /Index",
    });

    // A compressed stream that expands to 200,000 distinct type-2 containers.
    const rows = 200_000;
    const table = Buffer.alloc(rows * 5);
    for (let r = 0; r < rows; r += 1) {
      table[r * 5] = 2;
      table.writeUIntBE(r + 10, r * 5 + 1, 3);
    }
    const compressed = deflateSync(table);
    expect(scanPdfStructure(xref(`/Type /XRef /W [1 3 1] /Size ${rows} /Filter /FlateDecode`, compressed))).toEqual({
      reason: "unreadable",
      detail: "too many object stream containers",
    });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("fails closed on indirect or conflicting stream types", () => {
    const indirect = handPdf([CATALOG, ...PAGE_TREE, stream("/Type 5 0 R /Filter /FlateDecode", payload), "/ObjStm"]);
    expect(scanPdfStructure(indirect)).toEqual({ reason: "unreadable", detail: "indirect /Type" });

    const conflicting = handPdf([CATALOG, ...PAGE_TREE, stream("/Type /XRef /W [1 1 1] /Size 1 /N 1 /First 4", Buffer.from([1, 0, 0]))]);
    expect(scanPdfStructure(conflicting)).toEqual({ reason: "unreadable", detail: "conflicting stream markers" });
  });

  it("skips a font program only when a font descriptor references it", () => {
    const script = Buffer.from("/JS", "latin1");
    const orphan = handPdf([CATALOG, ...PAGE_TREE, "<< /FontFile2 5 0 R >>", stream("/Length1 3", script)]);
    expect(scanPdfStructure(orphan)).toEqual({ reason: "active_content", detail: "/JS" });

    const described = handPdf([CATALOG, ...PAGE_TREE, "<< /Type /FontDescriptor /FontName /X /FontFile2 5 0 R >>", stream("/Length1 3", script)]);
    expect(scanPdfStructure(described)).toBeNull();
  });
});

describe("inspectPdf — environment", () => {
  it("falls back to the default page limit", () => {
    expect(maxPdfPagesFromEnv({})).toBe(50);
    expect(maxPdfPagesFromEnv({ UPLOAD_MAX_PDF_PAGES: "10" })).toBe(10);
    expect(maxPdfPagesFromEnv({ UPLOAD_MAX_PDF_PAGES: "-1" })).toBe(50);
  });
});
