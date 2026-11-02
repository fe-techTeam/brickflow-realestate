# Engineering conventions

These conventions keep the four workspaces consistent. Read them before adding a page or a service.

## Layers

| Layer | Location | Rules |
| --- | --- | --- |
| Data model | `prisma/schema.prisma` | Money is `BigInt` **paise**. Percentages are integer **basis points** (`300` = 3%). |
| Services | `src/server/services/*` | All business rules, state transitions and authorisation. Every function takes the `Actor`. Never trust client values for money. |
| Server actions | `src/server/actions/*` | Thin wrappers: `requireActor()` → service → `revalidatePath` → `ActionResult`. |
| Pages | `src/app/(workspaces)/<workspace>/**/page.tsx` | Server components. Read through services, format on the server, pass plain serialisable props to client components. |
| Client components | colocated `*.tsx` with `"use client"` | Forms, dialogs, filters. Call bound server actions; show toasts with `sonner`. |
| Shared UI | `src/components/common/*`, `src/components/ui/*` | Reuse before creating. `ui/` holds the primitives; `common/` holds the BrickFlow building blocks. |

Workspace roots: `/partner` (channel partner), `/builder`, `/finance` (Veefin), `/admin` (super admin). The layout for each calls `requireWorkspace()`, so pages only need `requireWorkspace("<key>")` again when they use the actor.

## Money and numbers

- Use `formatINR(paise)` and `formatINRCompact(paise)` from `@/lib/money`. Never divide paise by 100 as a float.
- Use `formatBps(bps)` for percentages.
- Never pass `bigint` to a client component — convert with `.toString()` and format on the client with the same helpers.
- Apply the `tabular` utility to numeric table cells and figures.
- The discount formula lives only in `@/lib/financing#calculateDiscount`; the server recomputes all values.

## Status

- Use `<StatusBadge kind="invoice|financing|settlement|programme|offer|disbursement|record" status={...} />`.
- Invoice, financing and settlement statuses are separate fields; never infer one from another in the UI.
- For settlement status always use `effectiveSettlementStatus()` (derives NOT_DUE / DUE / OVERDUE from the due date).

## Pages

- Start every page with `<PageHeader eyebrow title description actions />`.
- Group content in `<Section title description actions>`.
- Tables: `DataTable` + `Th`/`Td`/`Tr` (or `SortTh` with `readSort`/`sortRows` for sortable columns). Put `ListToolbar` above lists for search/filter via URL params.
- Empty lists render `<EmptyState>` with a next-step action where one exists.
- Confirmations and reason capture use `<ActionDialog>` with a bound server action, e.g. `action={rejectInvoiceAction.bind(null, invoice.id)}`.
- Every route segment with data gets a `loading.tsx` using `Skeleton`.
- Label everything relating to payouts as simulated / demo.

## Visual language

Midnight Navy `#142B43` (navigation, primary), Heritage Green `#174D3C` (approvals, positive money), Champagne Gold `#C4A46A` (restrained accents only), Warm Ivory `#F5F2EA` (canvas), Soft Sage `#DCE8E1`, Slate `#303D4D`.
Tailwind tokens: `bg-navy`, `text-heritage`, `text-gold`, `bg-ivory`, `bg-sage`, `text-slate-ink`, plus `surface`, `eyebrow`, `tabular`, `animate-fade-up` utilities.
Headings use the display serif (`font-display`); body text uses Inter. Keep shadows subtle, radii modest, motion restrained.

## Security

- Authorise in services (organisation ownership + organisation type), not only in the UI.
- Scope every read with `invoiceScope(actor)` / `requestScope(actor)`; return "not found" rather than "forbidden" for records in another organisation.
- State changes use conditional `updateMany` with the expected current status to prevent double processing.
- Record an audit entry for every state change via `recordAudit(tx, actor, …)` inside the same transaction.

## Git workflow

See [CONTRIBUTING.md](../CONTRIBUTING.md).
