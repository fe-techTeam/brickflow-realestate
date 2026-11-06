/**
 * Minimal Prometheus registry (counters, gauges, histograms) rendered in text exposition format 0.0.4.
 * Process-local: each app instance is scraped separately.
 */

export type Labels = Record<string, string>;

type MetricType = "counter" | "gauge" | "histogram";

interface Series {
  labels: Labels;
  value: number;
}

interface HistogramSeries {
  labels: Labels;
  buckets: number[];
  sum: number;
  count: number;
}

const METRIC_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const LABEL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function labelKey(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join("\u0001");
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function escapeHelp(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

export function formatLabels(labels: Labels, extra?: Labels): string {
  const all = { ...labels, ...extra };
  const keys = Object.keys(all);
  if (keys.length === 0) return "";
  return `{${keys.map((k) => `${k}="${escapeLabelValue(all[k]!)}"`).join(",")}}`;
}

export function formatValue(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "+Inf";
  if (value === Number.NEGATIVE_INFINITY) return "-Inf";
  return String(value);
}

function assertLabels(labels: Labels) {
  for (const key of Object.keys(labels)) if (!LABEL_NAME.test(key) || key.startsWith("__")) throw new Error(`Invalid metric label name "${key}"`);
}

abstract class Metric {
  constructor(
    readonly name: string,
    readonly help: string,
    readonly type: MetricType,
  ) {
    if (!METRIC_NAME.test(name)) throw new Error(`Invalid metric name "${name}"`);
  }

  protected header(): string[] {
    return [`# HELP ${this.name} ${escapeHelp(this.help)}`, `# TYPE ${this.name} ${this.type}`];
  }

  abstract render(): string[];
}

export class Counter extends Metric {
  private readonly series = new Map<string, Series>();

  constructor(name: string, help: string) {
    super(name, help, "counter");
  }

  inc(labels: Labels = {}, by = 1): void {
    if (by < 0 || !Number.isFinite(by)) throw new Error("Counters only increase by finite, non-negative amounts");
    assertLabels(labels);
    const key = labelKey(labels);
    const existing = this.series.get(key);
    if (existing) existing.value += by;
    else this.series.set(key, { labels: { ...labels }, value: by });
  }

  get(labels: Labels = {}): number {
    return this.series.get(labelKey(labels))?.value ?? 0;
  }

  render(): string[] {
    return [...this.header(), ...[...this.series.values()].map((s) => `${this.name}${formatLabels(s.labels)} ${formatValue(s.value)}`)];
  }
}

export class Gauge extends Metric {
  private readonly series = new Map<string, Series>();

  constructor(name: string, help: string) {
    super(name, help, "gauge");
  }

  set(labels: Labels, value: number): void {
    assertLabels(labels);
    this.series.set(labelKey(labels), { labels: { ...labels }, value });
  }

  inc(labels: Labels = {}, by = 1): void {
    const key = labelKey(labels);
    const existing = this.series.get(key);
    if (existing) existing.value += by;
    else this.set(labels, by);
  }

  dec(labels: Labels = {}, by = 1): void {
    this.inc(labels, -by);
  }

  get(labels: Labels = {}): number {
    return this.series.get(labelKey(labels))?.value ?? 0;
  }

  reset(): void {
    this.series.clear();
  }

  render(): string[] {
    return [...this.header(), ...[...this.series.values()].map((s) => `${this.name}${formatLabels(s.labels)} ${formatValue(s.value)}`)];
  }
}

export class Histogram extends Metric {
  private readonly series = new Map<string, HistogramSeries>();
  readonly bounds: number[];

  constructor(name: string, help: string, bounds: number[]) {
    super(name, help, "histogram");
    this.bounds = [...bounds].sort((a, b) => a - b);
  }

  observe(labels: Labels, value: number): void {
    if (!Number.isFinite(value)) return;
    assertLabels(labels);
    const key = labelKey(labels);
    let series = this.series.get(key);
    if (!series) {
      series = { labels: { ...labels }, buckets: this.bounds.map(() => 0), sum: 0, count: 0 };
      this.series.set(key, series);
    }
    for (let i = 0; i < this.bounds.length; i++) if (value <= this.bounds[i]!) series.buckets[i]! += 1;
    series.sum += value;
    series.count += 1;
  }

  snapshot(labels: Labels): { buckets: number[]; sum: number; count: number } | undefined {
    const series = this.series.get(labelKey(labels));
    return series ? { buckets: [...series.buckets], sum: series.sum, count: series.count } : undefined;
  }

  render(): string[] {
    const lines = this.header();
    for (const s of this.series.values()) {
      this.bounds.forEach((bound, i) => lines.push(`${this.name}_bucket${formatLabels(s.labels, { le: formatValue(bound) })} ${s.buckets[i]}`));
      lines.push(`${this.name}_bucket${formatLabels(s.labels, { le: "+Inf" })} ${s.count}`);
      lines.push(`${this.name}_sum${formatLabels(s.labels)} ${formatValue(s.sum)}`);
      lines.push(`${this.name}_count${formatLabels(s.labels)} ${s.count}`);
    }
    return lines;
  }
}

export class Registry {
  private readonly metrics = new Map<string, Metric>();

  private register<T extends Metric>(metric: T): T {
    const existing = this.metrics.get(metric.name);
    if (existing) {
      if (existing.type !== metric.type) throw new Error(`Metric ${metric.name} is already registered as a ${existing.type}`);
      return existing as T;
    }
    this.metrics.set(metric.name, metric);
    return metric;
  }

  counter(name: string, help: string): Counter {
    return this.register(new Counter(name, help));
  }

  gauge(name: string, help: string): Gauge {
    return this.register(new Gauge(name, help));
  }

  histogram(name: string, help: string, bounds: number[]): Histogram {
    return this.register(new Histogram(name, help, bounds));
  }

  render(): string {
    return [...this.metrics.values()].flatMap((m) => m.render()).join("\n");
  }
}

/** Builds a one-off gauge block for values computed at scrape time (not kept in the registry). */
export function renderGauge(name: string, help: string, series: { labels?: Labels; value: number }[]): string {
  const gauge = new Gauge(name, help);
  for (const s of series) gauge.set(s.labels ?? {}, s.value);
  return gauge.render().join("\n");
}

const REGISTRY_KEY = Symbol.for("brickflow.observability.registry");
const holder = globalThis as unknown as Record<symbol, Registry | undefined>;

/** The process-wide registry, shared by the HTTP hook and the metrics route even across bundles. */
export const registry: Registry = (holder[REGISTRY_KEY] ??= new Registry());

export const HTTP_DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export const httpRequestsTotal = registry.counter("http_requests_total", "HTTP requests handled, by route group, method and status class.");
export const httpRequestDuration = registry.histogram(
  "http_request_duration_seconds",
  "HTTP request latency in seconds, by route group and method.",
  HTTP_DURATION_BUCKETS,
);
export const httpRequestsInFlight = registry.gauge("http_requests_in_flight", "HTTP requests currently being handled.");
