# Assumptions and open questions

Decisions made during implementation where the brief was silent or ambiguous. Each item is marked **Open** until confirmed by the product owner.

| # | Area | Assumption | Status |
| --- | --- | --- | --- |
| A1 | Invoice amount | "Invoice amount" is the **gross total including GST**. The optional GST field records the tax component contained in it. Financing is calculated on the builder-approved amount, which defaults to the invoice total. | Open |
| A2 | Partial approval | Builders may approve a lower amount than invoiced (never higher). The discount applies to the approved amount. | Open |
| A3 | One programme per builder | A builder can have only one **active** financing programme at a time, so the applicable rate is unambiguous. Activating a second one is refused until the first is suspended/closed. | Open |
| A4 | Rate changes vs open offers | Changing a programme's terms withdraws (supersedes) any **un-accepted** offers priced on it; the CP regenerates to see current terms. Accepted requests keep their stored snapshot and are never repriced. | Open |
| A5 | Offer validity | Offers are valid for the programme's `offerValidityDays` (default 7). Expired offers can be regenerated while the invoice remains eligible. | Open |
| A6 | Financier rejection | A financing request rejected by Veefin is final for that invoice (no re-request), which also enforces one financing request per invoice. | Open |
| A7 | Disbursement simulation | Disbursement is two explicit steps for realism: **Initiate** (instruction booked, reference generated) → **Confirm simulated transfer** (UTR generated, status DISBURSED). No bank integration exists. | Open |
| A8 | Settlement | Settlement amount = builder-approved invoice amount, due on the invoice due date, or invoice date + empanelment credit period when no due date was given. NOT_DUE / DUE / OVERDUE are derived from the date; SETTLED is set manually by a Veefin user. | Open |
| A9 | Eligibility | An accepted invoice is eligible for early payment only while its due date is in the future and an active programme exists for its builder. | Open |
| A10 | Clarification loop | When a builder requests clarification, the CP responds with a note (and optionally a replacement PDF), which returns the invoice to the builder's inbox. | Open |
| A11 | Organisation names | "Godrej Properties Demo" and "Prestige Realty Partners" are used as instructed and suffixed/marked as demo. No logos or proprietary assets are used; all identifiers (GSTIN, PAN, RERA, bank) are fictional. | Open |
| A12 | GST on sample invoices | Sample brokerage invoices use SAC 997222 at 18% GST, split CGST/SGST for intra-state and IGST for inter-state supplies. | Open |
| A13 | Deployment target | Local development uses SQLite and local file storage (zero configuration). For hosting (AWS or Vercel) the database should move to PostgreSQL (RDS / Neon / Vercel Postgres) and uploaded PDFs to object storage (S3 / Vercel Blob), because serverless and container file systems are not durable. The final target, region and domain need confirmation. | Open |
| A14 | OCR assets | Tesseract.js runs in the browser; its WASM core and English language data are fetched from the public CDN on first use. Invoice documents themselves never leave the user's machine for extraction. | Open |
| A15 | Users per organisation | Each demo user belongs to exactly one organisation. The data model supports multiple memberships for later. | Open |
| A16 | Branch protection | `develop` requires a pull request and passing CI but **no approving review** (single-developer team for now); `main` requires a pull request from `develop`, passing CI and one approval. Raise the review requirement on `develop` when the team grows. | Open |
