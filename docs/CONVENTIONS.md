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

## Design system building blocks

Tokens, utilities and components added for the premium visual system. All existing props still work; everything below is additive.

**Type and utilities.** Page titles use `display-title` (Playfair Display), brand moments `display-hero`, section headings `heading-section`; italic accents use `font-accent` / `kicker` (Cormorant Garamond). Every amount, count and rate uses `figure`, which sets Inter with tabular, lining numerals. Lines: `hairline` (border colour), `gold-rule`, `gold-rule-center`, `hairline-rule`. Surfaces: `surface`, `surface-raised`, `surface-quiet`, `surface-navy`. Gold is an accent only, never a fill for large areas.

**Buttons.** `variant`: `default` (navy primary), `gold` (one special action per screen, e.g. *Accept offer*), `success` (approvals, financing), `outline`, `secondary`, `ghost`, `destructive`, `link`.

| Component | Import | Notes |
| --- | --- | --- |
| `PageHeader` | `common/page-header` | Adds `kicker` (italic line above the title), `meta` (chips under the description) and `divider`. |
| `StatCard` | `common/stat-card` | Adds `trend`, `footer` and `emphasis="gold" \| "navy"` for the one or two hero metrics in a row. Values render as `figure`. |
| `HeroMetric` | `common/hero-metric` | One headline figure: `label`, `value`, `context`, `icon`, `trend`, `aside` (e.g. `KeyFigureRow`), `footer`, `variant="navy" \| "ivory"`. |
| `KeyFigure`, `KeyFigureRow` | `common/key-figure` | Compact label/value pairs: `tone` (`navy`, `heritage`, `gold`, `danger`, `light`), `size`, `align`, `hint`. Use `KeyFigureRow onDark` inside navy panels. |
| `Money` | `common/money` | `<Money paise={...} />` formats INR with the paise de-emphasised. `compact`, `showPaise`, `tone` (`positive`, `negative`, `gold`, `muted`, `navy`), `display` for large figures. Accepts `bigint`, number or string paise. |
| `Trend` | `common/trend` | `value`, `direction`, `sentiment`, `label`; used by `StatCard`/`HeroMetric` but usable alone. |
| `ChartFrame` | `common/chart-frame` | Chart card: `title`, `eyebrow`, `description`, `figure`, `legend`, `actions`, `height`, `empty`, `table` (accessible data fallback), `label`, `footer`, `bare`. Also exports `ChartLegend` and `ChartTooltipCard`. |
| Chart theme | `common/chart-theme` | `CHART_COLORS`, `CHART_SERIES`, `chartXAxisProps`, `chartYAxisProps`, `chartGridProps`, `chartTooltipProps`, `chartBarProps`, `chartLineProps`, `chartLegendProps`, `chartAreaGradientStops(color)`. Spread them onto Recharts elements so all charts match. |
| `DataTable` | `common/data-table` | Adds `zebra` and `dense`. Rows highlight on hover with a gold edge. |
| `DetailList`, `Timeline`, `AmountRow`, `EmptyState`, `Section` | `common/panels` | `DetailItem.emphasis` renders as a figure; `TimelineEntry.tone` adds `gold`. |
| `ActionDialog` | `common/action-dialog` | Shows a tone medallion from `confirmVariant`; override with `icon` or hide with `icon={null}`. |
| `ErrorState`, `errorDigest` | `common/error-state` | Card for workspace `error.tsx`: `<ErrorState error={error} onRetry={retry} back={{ href: "/builder", label: "Back to overview" }} />`. |
| `StatusScreen` | `brand/status-screen` | Full-page brand composition used by the root `not-found`, `error` and `global-error` pages. |
| `Logo`, `LogoMark`, `ArchitecturalScene` | `brand/*` | `Logo` takes `tone`, `size` (`sm`, `md`, `lg`), `showTagline`. The scene is decorative and respects reduced motion. |

Toasts (`sonner`) are already themed: call `toast.success`, `toast.error` and so on as usual.

## Security

- Authorise in services (organisation ownership + organisation type), not only in the UI.
- Scope every read with `invoiceScope(actor)` / `requestScope(actor)`; return "not found" rather than "forbidden" for records in another organisation.
- State changes use conditional `updateMany` with the expected current status to prevent double processing.
- Record an audit entry for every state change via `recordAudit(tx, actor, …)` inside the same transaction.

## Git workflow

See [CONTRIBUTING.md](../CONTRIBUTING.md).
