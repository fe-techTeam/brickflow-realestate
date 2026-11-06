import { monitorEventLoopDelay } from "node:perf_hooks";
import { renderGauge } from "./metrics";

type IntervalHistogram = ReturnType<typeof monitorEventLoopDelay>;

const LOOP_KEY = Symbol.for("brickflow.observability.eventLoopDelay");
const holder = globalThis as unknown as Record<symbol, IntervalHistogram | undefined>;

function eventLoopDelay(): IntervalHistogram {
  let histogram = holder[LOOP_KEY];
  if (!histogram) {
    histogram = monitorEventLoopDelay({ resolution: 20 });
    histogram.enable();
    holder[LOOP_KEY] = histogram;
  }
  return histogram;
}

export interface RuntimeInfo {
  service: string;
  version: string;
}

/** Process and Node.js runtime metrics in Prometheus text format. */
export function renderRuntimeMetrics(info: RuntimeInfo, now: number = Date.now()): string {
  const cpu = process.cpuUsage();
  const memory = process.memoryUsage();
  const loop = eventLoopDelay();
  const startSeconds = Math.round((now - process.uptime() * 1000) / 1000);
  const blocks = [
    renderGauge("brickflow_build_info", "Build information; the value is always 1.", [{ labels: { service: info.service, version: info.version, node_version: process.version }, value: 1 }]),
    `# HELP process_cpu_user_seconds_total User CPU time spent in seconds.\n# TYPE process_cpu_user_seconds_total counter\nprocess_cpu_user_seconds_total ${cpu.user / 1e6}`,
    `# HELP process_cpu_system_seconds_total System CPU time spent in seconds.\n# TYPE process_cpu_system_seconds_total counter\nprocess_cpu_system_seconds_total ${cpu.system / 1e6}`,
    `# HELP process_cpu_seconds_total Total user and system CPU time spent in seconds.\n# TYPE process_cpu_seconds_total counter\nprocess_cpu_seconds_total ${(cpu.user + cpu.system) / 1e6}`,
    renderGauge("process_start_time_seconds", "Start time of the process since the Unix epoch in seconds.", [{ value: startSeconds }]),
    renderGauge("process_uptime_seconds", "Process uptime in seconds.", [{ value: Math.round(process.uptime()) }]),
    renderGauge("process_resident_memory_bytes", "Resident memory size in bytes.", [{ value: memory.rss }]),
    renderGauge("nodejs_heap_size_total_bytes", "V8 heap size allocated in bytes.", [{ value: memory.heapTotal }]),
    renderGauge("nodejs_heap_size_used_bytes", "V8 heap size used in bytes.", [{ value: memory.heapUsed }]),
    renderGauge("nodejs_external_memory_bytes", "Memory used by C++ objects bound to JavaScript objects, in bytes.", [{ value: memory.external }]),
    renderGauge("nodejs_active_resources", "Active libuv resources keeping the event loop alive.", [{ value: process.getActiveResourcesInfo().length }]),
    renderGauge("nodejs_eventloop_lag_seconds", "Event loop delay percentiles since the previous scrape, in seconds.", [
      { labels: { quantile: "0.5" }, value: loop.percentile(50) / 1e9 },
      { labels: { quantile: "0.99" }, value: loop.percentile(99) / 1e9 },
      { labels: { quantile: "1" }, value: loop.max / 1e9 },
    ]),
  ];
  loop.reset();
  return blocks.join("\n");
}
