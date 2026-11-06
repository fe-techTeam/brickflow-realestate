import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { amountInWordsINR } from "../amount-words";
import { formatBps, formatINR } from "../money";

export interface InvoiceParty {
  legalName: string;
  addressLines: string[];
  gstin?: string | null;
  pan?: string | null;
  reraNumber?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface BrokerageInvoiceData {
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate?: Date | null;
  placeOfSupply: string;
  supplier: InvoiceParty & { bank?: { name: string; account: string; ifsc: string } | null };
  recipient: InvoiceParty;
  project: { name: string; code: string; city: string; reraNumber?: string | null };
  lines: { description: string; detail?: string; sac: string; amountPaise: bigint }[];
  /** Intra-state supplies split GST into CGST + SGST; inter-state use IGST. */
  gst: { mode: "INTRA" | "INTER"; ratePercent: number } | null;
  notes?: string[];
  /** Booking the brokerage relates to. Buyer identity is limited to initials. */
  booking?: { tower: string; unit: string; buyerInitials?: string | null } | null;
  agreement?: { registrationNumber: string; date: Date; valuePaise: bigint; brokerageBps?: number | null } | null;
  /** E-invoice registration issued by the IRP. */
  eInvoice?: { irn: string; ackNumber: string; ackDate: Date } | null;
  /** TDS the recipient is expected to deduct under section 194H, in basis points. */
  tdsRateBps?: number | null;
}

export interface GstBreakdown {
  taxablePaise: bigint;
  cgstPaise: bigint;
  sgstPaise: bigint;
  igstPaise: bigint;
  totalPaise: bigint;
}

/** Splits a GST-inclusive total into taxable value and tax at the given rate, rounding to the paisa. */
export function splitGstInclusive(totalPaise: bigint, ratePercent: number, mode: "INTRA" | "INTER"): GstBreakdown {
  const rate = BigInt(Math.round(ratePercent * 100));
  const taxablePaise = (totalPaise * 10_000n + (10_000n + rate) / 2n) / (10_000n + rate);
  const tax = totalPaise - taxablePaise;
  if (mode === "INTER") return { taxablePaise, cgstPaise: 0n, sgstPaise: 0n, igstPaise: tax, totalPaise };
  const cgstPaise = tax / 2n;
  return { taxablePaise, cgstPaise, sgstPaise: tax - cgstPaise, igstPaise: 0n, totalPaise };
}

// A channel partner's own letterhead, so deliberately neutral rather than in platform colours.
const HEAD = rgb(0x22 / 255, 0x2a / 255, 0x28 / 255);
const LABEL = rgb(0x6b / 255, 0x5e / 255, 0x4b / 255);
const INK = rgb(0x2a / 255, 0x33 / 255, 0x31 / 255);
const MUTED = rgb(0.4, 0.43, 0.42);
const RULE = rgb(0.86, 0.87, 0.85);
const SHADE = rgb(0xf0 / 255, 0xf1 / 255, 0xee / 255);

const inr = (paise: bigint) => `INR ${formatINR(paise, { symbol: false })}`;
const date = (d: Date) => new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(d);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  display: PDFFont;
  italic: PDFFont;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) current = candidate;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function text(page: PDFPage, value: string, x: number, y: number, font: PDFFont, size: number, color = INK) {
  page.drawText(value, { x, y, font, size, color });
}

function rightText(page: PDFPage, value: string, right: number, y: number, font: PDFFont, size: number, color = INK) {
  page.drawText(value, { x: right - font.widthOfTextAtSize(value, size), y, font, size, color });
}

function partyBlock(page: PDFPage, fonts: Fonts, title: string, party: InvoiceParty, x: number, y: number, width: number): number {
  text(page, title.toUpperCase(), x, y, fonts.bold, 7, LABEL);
  let cursor = y - 15;
  for (const line of wrap(party.legalName, fonts.bold, 10.5, width)) {
    text(page, line, x, cursor, fonts.bold, 10.5, HEAD);
    cursor -= 13;
  }
  for (const line of party.addressLines.flatMap((l) => wrap(l, fonts.regular, 8.5, width))) {
    text(page, line, x, cursor, fonts.regular, 8.5);
    cursor -= 11;
  }
  cursor -= 3;
  const meta: [string, string | null | undefined][] = [
    ["GSTIN", party.gstin],
    ["PAN", party.pan],
    ["RERA", party.reraNumber],
    ["Email", party.email],
    ["Phone", party.phone],
  ];
  for (const [label, value] of meta) {
    if (!value) continue;
    text(page, `${label}:`, x, cursor, fonts.bold, 8, MUTED);
    text(page, value, x + 38, cursor, fonts.regular, 8.5);
    cursor -= 11;
  }
  return cursor;
}

/** Label/value pairs for the booking & agreement band, laid out two per row. */
function bookingParticulars(data: BrokerageInvoiceData): [string, string][] {
  const rows: [string, string][] = [];
  const { booking, agreement } = data;
  if (booking) {
    const tower = /^(tower|wing|block|phase)\b/i.test(booking.tower) ? booking.tower : `Tower ${booking.tower}`;
    rows.push(["Booking:", [tower, `Unit ${booking.unit}`, booking.buyerInitials ? `Buyer ${booking.buyerInitials}` : null].filter(Boolean).join(" · ")]);
  }
  if (agreement) {
    rows.push(["Agreement value:", inr(agreement.valuePaise)]);
    rows.push(["Agreement for sale:", agreement.registrationNumber]);
    rows.push(["Agreement date:", date(agreement.date)]);
    if (agreement.brokerageBps) {
      const agreed = (agreement.valuePaise * BigInt(agreement.brokerageBps) + 5_000n) / 10_000n;
      rows.push(["Brokerage:", `${formatBps(agreement.brokerageBps)} of agreement value · ${inr(agreed)}`]);
    }
  }
  if (rows.length && data.tdsRateBps != null) rows.push(["TDS u/s 194H:", formatBps(data.tdsRateBps)]);
  return rows;
}

/** Renders a professional A4 GST brokerage tax invoice. Works in Node and the browser. */
export async function renderBrokerageInvoicePdf(data: BrokerageInvoiceData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Tax Invoice ${data.invoiceNumber}`);
  doc.setAuthor(data.supplier.legalName);
  doc.setSubject(`Brokerage invoice for ${data.project.name}`);
  doc.setKeywords(["brokerage", "tax invoice", data.invoiceNumber, data.project.code]);
  doc.setCreator("BrickFlow demo document generator");
  doc.setProducer("BrickFlow");
  doc.setCreationDate(data.invoiceDate);

  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    display: await doc.embedFont(StandardFonts.TimesRomanBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };

  const page = doc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const margin = 44;
  const contentWidth = width - margin * 2;

  page.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: HEAD });
  page.drawRectangle({ x: 0, y: height - 10, width, height: 2, color: LABEL });

  let y = height - 58;
  const supplierName = data.supplier.legalName;
  for (const line of wrap(supplierName, fonts.display, 19, contentWidth * 0.58)) {
    text(page, line, margin, y, fonts.display, 19, HEAD);
    y -= 21;
  }
  text(page, "Real estate channel partner · Brokerage & advisory services", margin, y + 4, fonts.regular, 8.5, MUTED);
  if (data.eInvoice) {
    y -= 13;
    text(page, "IRN:", margin, y + 4, fonts.bold, 7, LABEL);
    text(page, data.eInvoice.irn, margin + 19, y + 4, fonts.regular, 7, INK);
  }

  rightText(page, "TAX INVOICE", width - margin, height - 56, fonts.display, 22, HEAD);
  rightText(page, "Original for recipient", width - margin, height - 70, fonts.italic, 8, MUTED);

  const metaTop = height - 92;
  const metaRows: [string, string][] = [
    ["Invoice No.", data.invoiceNumber],
    ["Invoice Date", date(data.invoiceDate)],
    ["Due Date", data.dueDate ? date(data.dueDate) : "As per empanelment terms"],
    ["Place of Supply", data.placeOfSupply],
  ];
  if (data.eInvoice) metaRows.push(["Ack No.", data.eInvoice.ackNumber], ["Ack Date", date(data.eInvoice.ackDate)]);
  metaRows.forEach(([label, value], i) => {
    const rowY = metaTop - i * 13;
    rightText(page, value, width - margin, rowY, fonts.bold, 8.5, HEAD);
    rightText(page, label, width - margin - 130, rowY, fonts.regular, 8.5, MUTED);
  });

  y = Math.min(y - 14, metaTop - metaRows.length * 13 - 12);
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.8, color: RULE });

  const colWidth = contentWidth / 2 - 12;
  const top = y - 20;
  const leftEnd = partyBlock(page, fonts, "Supplier (Channel Partner)", data.supplier, margin, top, colWidth);
  const rightEnd = partyBlock(page, fonts, "Bill To (Builder)", data.recipient, margin + contentWidth / 2 + 12, top, colWidth);
  y = Math.min(leftEnd, rightEnd) - 8;

  const particulars = bookingParticulars(data);
  const bandHeight = 38 + (particulars.length ? 24 + Math.ceil(particulars.length / 2) * 12 : 0);
  page.drawRectangle({ x: margin, y: y - bandHeight, width: contentWidth, height: bandHeight, color: SHADE });
  text(page, "PROJECT", margin + 12, y - 14, fonts.bold, 7, LABEL);
  text(page, `${data.project.name} (${data.project.code}), ${data.project.city}`, margin + 12, y - 28, fonts.bold, 9.5, HEAD);
  if (data.project.reraNumber) rightText(page, `Project RERA: ${data.project.reraNumber}`, width - margin - 12, y - 28, fonts.regular, 8.5);
  if (particulars.length) {
    const top = y - 38;
    page.drawLine({ start: { x: margin + 12, y: top }, end: { x: width - margin - 12, y: top }, thickness: 0.5, color: RULE });
    text(page, "BOOKING & AGREEMENT", margin + 12, top - 13, fonts.bold, 7, LABEL);
    particulars.forEach(([label, value], i) => {
      const x = margin + 12 + (i % 2) * (contentWidth / 2);
      const rowY = top - 27 - Math.floor(i / 2) * 12;
      text(page, label, x, rowY, fonts.bold, 8, MUTED);
      text(page, value, x + fonts.bold.widthOfTextAtSize(label, 8) + 4, rowY, fonts.regular, 8.5, HEAD);
    });
  }
  y -= bandHeight + 20;

  const cols = { no: margin, desc: margin + 26, sac: margin + contentWidth - 170, amt: width - margin };
  page.drawRectangle({ x: margin, y: y - 6, width: contentWidth, height: 20, color: HEAD });
  text(page, "#", cols.no + 8, y, fonts.bold, 8, rgb(1, 1, 1));
  text(page, "DESCRIPTION OF SERVICE", cols.desc, y, fonts.bold, 8, rgb(1, 1, 1));
  text(page, "SAC", cols.sac, y, fonts.bold, 8, rgb(1, 1, 1));
  rightText(page, "TAXABLE VALUE", cols.amt - 8, y, fonts.bold, 8, rgb(1, 1, 1));
  y -= 24;

  const gst = data.gst;
  data.lines.forEach((line, index) => {
    const descLines = wrap(line.description, fonts.bold, 9, cols.sac - cols.desc - 14);
    const detailLines = line.detail ? wrap(line.detail, fonts.regular, 8, cols.sac - cols.desc - 14) : [];
    text(page, String(index + 1), cols.no + 8, y, fonts.regular, 9);
    let rowY = y;
    for (const l of descLines) {
      text(page, l, cols.desc, rowY, fonts.bold, 9, HEAD);
      rowY -= 12;
    }
    for (const l of detailLines) {
      text(page, l, cols.desc, rowY, fonts.regular, 8, MUTED);
      rowY -= 11;
    }
    text(page, line.sac, cols.sac, y, fonts.regular, 9);
    const taxable = gst ? splitGstInclusive(line.amountPaise, gst.ratePercent, gst.mode).taxablePaise : line.amountPaise;
    rightText(page, inr(taxable), cols.amt - 8, y, fonts.regular, 9);
    y = rowY - 8;
    page.drawLine({ start: { x: margin, y: y + 4 }, end: { x: width - margin, y: y + 4 }, thickness: 0.5, color: RULE });
    y -= 8;
  });

  const total = data.lines.reduce((sum, l) => sum + l.amountPaise, 0n);
  const breakdown = gst ? splitGstInclusive(total, gst.ratePercent, gst.mode) : { taxablePaise: total, cgstPaise: 0n, sgstPaise: 0n, igstPaise: 0n, totalPaise: total };

  const summary: [string, bigint][] = [["Taxable value", breakdown.taxablePaise]];
  if (gst?.mode === "INTRA") {
    summary.push([`CGST @ ${gst.ratePercent / 2}%`, breakdown.cgstPaise], [`SGST @ ${gst.ratePercent / 2}%`, breakdown.sgstPaise]);
  } else if (gst?.mode === "INTER") {
    summary.push([`IGST @ ${gst.ratePercent}%`, breakdown.igstPaise]);
  }
  const sumX = margin + contentWidth - 240;
  y -= 4;
  for (const [label, value] of summary) {
    text(page, label, sumX, y, fonts.regular, 9, MUTED);
    rightText(page, inr(value), cols.amt - 8, y, fonts.regular, 9);
    y -= 15;
  }
  y -= 10;
  page.drawRectangle({ x: sumX - 10, y: y - 10, width: cols.amt - sumX + 10, height: 26, color: HEAD });
  text(page, "TOTAL INVOICE VALUE", sumX, y, fonts.bold, 8.5, LABEL);
  rightText(page, inr(breakdown.totalPaise), cols.amt - 8, y, fonts.bold, 10.5, rgb(1, 1, 1));
  y -= 30;

  text(page, "Amount in words", margin, y, fonts.bold, 7.5, LABEL);
  y -= 12;
  for (const l of wrap(amountInWordsINR(breakdown.totalPaise), fonts.italic, 9, contentWidth)) {
    text(page, l, margin, y, fonts.italic, 9, HEAD);
    y -= 12;
  }
  if (!gst) {
    text(page, "GST not applicable on this supply.", margin, y, fonts.regular, 8, MUTED);
    y -= 12;
  }
  y -= 10;

  const footerTop = Math.min(y, 250);
  page.drawLine({ start: { x: margin, y: footerTop }, end: { x: width - margin, y: footerTop }, thickness: 0.8, color: RULE });

  let left = footerTop - 18;
  if (data.supplier.bank) {
    text(page, "BANK DETAILS FOR PAYMENT", margin, left, fonts.bold, 7, LABEL);
    left -= 14;
    const bankRows: [string, string][] = [
      ["Account name", data.supplier.legalName],
      ["Bank", data.supplier.bank.name],
      ["Account no.", data.supplier.bank.account],
      ["IFSC", data.supplier.bank.ifsc],
    ];
    for (const [label, value] of bankRows) {
      text(page, label, margin, left, fonts.regular, 8, MUTED);
      text(page, value, margin + 70, left, fonts.regular, 8.5);
      left -= 12;
    }
  }
  left -= 8;
  text(page, "TERMS & DECLARATION", margin, left, fonts.bold, 7, LABEL);
  left -= 13;
  const notes = data.notes ?? [];
  for (const note of notes) {
    for (const l of wrap(`• ${note}`, fonts.regular, 7.5, contentWidth / 2 + 20)) {
      text(page, l, margin, left, fonts.regular, 7.5, MUTED);
      left -= 10;
    }
  }

  const signX = width - margin - 190;
  text(page, `For ${data.supplier.legalName}`.slice(0, 48), signX, footerTop - 18, fonts.bold, 8.5, HEAD);
  page.drawRectangle({ x: signX, y: footerTop - 92, width: 190, height: 60, borderColor: RULE, borderWidth: 0.8, borderDashArray: [3, 3] });
  text(page, "Signature & company seal", signX + 48, footerTop - 66, fonts.italic, 7.5, MUTED);
  page.drawLine({ start: { x: signX, y: footerTop - 104 }, end: { x: signX + 190, y: footerTop - 104 }, thickness: 0.6, color: INK });
  text(page, "Authorised Signatory", signX, footerTop - 116, fonts.bold, 8.5, HEAD);

  page.drawRectangle({ x: 0, y: 0, width, height: 30, color: SHADE });
  text(page, "This is a computer-generated invoice.", margin, 12, fonts.italic, 7, MUTED);
  rightText(page, "Page 1 of 1", width - margin, 12, fonts.regular, 7, MUTED);

  return doc.save();
}
