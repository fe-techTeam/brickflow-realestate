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
- Payouts have no bank integration (simulated in code); keep that fact in developer docs, and write interface copy as for a live product.

## Visual language

The interface is a dark glass theme: light text over a slate-blue dusk gradient, with translucent layered surfaces.

| Role | Token | Value | Use |
| --- | --- | --- | --- |
| Text | `fg`, `fg-soft`, `fg-muted` | `#F5F8FB`, `#DBE3EB`, `#AEBBC9` | Headings and figures, body, secondary text. |
| Night | `night`, `night-deep`, `night-solid` | translucent slate; `#263345` | Hero panels, primary buttons, banners; `night-solid` where opacity is required. |
| Glass | `glass-50` … `glass-400` | white at 3.5–22% | Quiet fills, hovers, table headers, chips. |
| Lines | `line`, `line-strong`, `haze` | white at 9% / 18%; mist | Borders, rules, quiet detail. |
| Signal | `signal-*` | `#FFC247` | The single accent: early-payment action, active navigation, focus, the logo. |
| Leaf | `leaf-*` | `#3ABF94` | Approved, paid, settled. Low shades are dark tints for chips; high shades are text. |
| Status | `danger`, `warning`, `info`, `violet` | `#FF7B6E`, `#FF9F5A`, `#8FC4FF`, `#A98BFF` | Rejected, pending, informational, chart series. |

Rules: cards use `surface` (translucent with backdrop blur); popups (dialogs, sheets, menus, selects) are always opaque (`--popover`) so page content never bleeds through text. Charts use `CHART_SERIES` from `common/chart-theme.ts` (signal, leaf, coral, violet, mist). Headings use Inter at light weights; figures use `figure`. Invoice PDFs keep a neutral letterhead because they are the channel partner's documents.
Utilities: `surface`, `surface-basalt` (deeper glass panel), `surface-quiet`, `eyebrow`, `figure`, `tabular`, `kota-rule`, `animate-fade-up`.
Headings and body use Inter (`font-display` maps to Inter). Keep shadows soft, radii modest (8px), motion restrained.

## Design system building blocks

Tokens, utilities and components added for the premium visual system. All existing props still work; everything below is additive.

**Type and utilities.** Page titles use `display-title` (Inter Light), brand moments `display-hero`, section headings `heading-section`; secondary title words use `kicker` (Inter Light, muted). Every amount, count and rate uses `figure`, which sets Inter with tabular, lining numerals. Lines: `hairline` (border colour), `kota-rule`, `kota-rule-center`, `hairline-rule`. Surfaces: `surface`, `surface-raised`, `surface-quiet`, `surface-basalt`. Signal is an accent only, never a fill for large areas.

**Buttons.** `variant`: `default` (glass primary), `accent` (signal yellow; one special action per screen, e.g. *Get discounted amount*), `success` (approvals, financing), `outline`, `secondary`, `ghost`, `destructive`, `link`.

| Component | Import | Notes |
| --- | --- | --- |
| `PageHeader` | `common/page-header` | Adds `kicker` (italic line above the title), `meta` (chips under the description) and `divider`. |
| `StatCard` | `common/stat-card` | Adds `trend`, `footer` and `emphasis="kota" \| "basalt"` for the one or two hero metrics in a row. Values render as `figure`. |
| `HeroMetric` | `common/hero-metric` | One headline figure: `label`, `value`, `context`, `icon`, `trend`, `aside` (e.g. `KeyFigureRow`), `footer`, `variant="basalt" \| "paper"`. |
| `KeyFigure`, `KeyFigureRow` | `common/key-figure` | Compact label/value pairs: `tone` (`basalt`, `leaf`, `kota`, `danger`, `light`), `size`, `align`, `hint`. Use `KeyFigureRow onDark` inside basalt panels. |
| `Money` | `common/money` | `<Money paise={...} />` formats INR with the paise de-emphasised. `compact`, `showPaise`, `tone` (`positive`, `negative`, `kota`, `muted`, `basalt`), `display` for large figures. Accepts `bigint`, number or string paise. |
| `Trend` | `common/trend` | `value`, `direction`, `sentiment`, `label`; used by `StatCard`/`HeroMetric` but usable alone. |
| `ChartFrame` | `common/chart-frame` | Chart card: `title`, `eyebrow`, `description`, `figure`, `legend`, `actions`, `height`, `empty`, `table` (accessible data fallback), `label`, `footer`, `bare`. Also exports `ChartLegend` and `ChartTooltipCard`. |
| Chart theme | `common/chart-theme` | `CHART_COLORS`, `CHART_SERIES`, `chartXAxisProps`, `chartYAxisProps`, `chartGridProps`, `chartTooltipProps`, `chartBarProps`, `chartLineProps`, `chartLegendProps`, `chartAreaGradientStops(color)`. Spread them onto Recharts elements so all charts match. |
| `DataTable` | `common/data-table` | Adds `zebra` and `dense`. Rows highlight on hover with a stone edge. |
| `DetailList`, `Timeline`, `AmountRow`, `EmptyState`, `Section` | `common/panels` | `DetailItem.emphasis` renders as a figure; `TimelineEntry.tone` adds `kota`. |
| `ActionDialog` | `common/action-dialog` | Shows a tone medallion from `confirmVariant`; override with `icon` or hide with `icon={null}`. |
| `ErrorState`, `errorDigest` | `common/error-state` | Card for workspace `error.tsx`: `<ErrorState error={error} onRetry={retry} back={{ href: "/builder", label: "Back to overview" }} />`. |
| `BreadcrumbLabel` | `shell/breadcrumbs` | Optional. Render `<BreadcrumbLabel label={invoice.number} />` on a detail page to name the last breadcrumb. Without it the shell derives a record name from the route (e.g. "Invoice", "Financing request", "Transaction"). |
| `StatusScreen` | `brand/status-screen` | Full-page brand composition used by the root `not-found`, `error` and `global-error` pages. |
| `Logo`, `LogoMark`, `ArchitecturalScene` | `brand/*` | `Logo` takes `tone`, `size` (`sm`, `md`, `lg`), `showTagline`. The scene is decorative and respects reduced motion. |

Toasts (`sonner`) are already themed: call `toast.success`, `toast.error` and so on as usual.

## Security

- Authorise in services (organisation ownership + organisation type), not only in the UI.
- Scope every read with `invoiceScope(actor)` / `requestScope(actor)`; return "not found" rather than "forbidden" for records in another organisation.
- State changes use conditional `updateMany` with the expected current status to prevent double processing.
- Record an audit entry for every state change via `recordAudit(tx, actor, …)` inside the same transaction, as late as possible: it appends to the hash chain under a transaction-scoped lock. Never write to `AuditLog` directly.
- Server code logs through `logger` from `@/server/observability/logger` (JSON lines with request and actor IDs, secrets redacted), not `console`. Use dotted event names, e.g. `logger.error("reports.export_failed", { err })`.

## Git workflow

See [CONTRIBUTING.md](../CONTRIBUTING.md).
