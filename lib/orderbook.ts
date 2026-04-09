import { useEffect, useRef, useState } from "react";

const WS_URL = "wss://api-pub.bitfinex.com/ws/2";

export type OrderbookEntry = {
  price: number;
  count: number;
  amount: number;
  total: number;
};

export type PerfMetrics = {
  // Per-update timing
  avgParseTimeUs: number;      // JSON.parse time in microseconds
  avgProcessTimeUs: number;    // applyUpdate + sort + build time in microseconds
  avgFlushTimeUs: number;      // setState call time in microseconds
  // Throughput
  updatesPerSec: number;
  rendersPerSec: number;
  // Peaks
  maxParseTimeUs: number;
  maxProcessTimeUs: number;
  maxFlushTimeUs: number;
  // Totals
  totalUpdates: number;
  totalRenders: number;
  uptimeSec: number;
  // Snapshot
  snapshotParseTimeUs: number;
  snapshotProcessTimeUs: number;
};

export type OrderbookState = {
  bids: OrderbookEntry[];
  asks: OrderbookEntry[];
  spread: number;
  spreadPercent: number;
  connected: boolean;
  lastUpdateTs: number;
  perf: PerfMetrics;
};

const EMPTY_PERF: PerfMetrics = {
  avgParseTimeUs: 0,
  avgProcessTimeUs: 0,
  avgFlushTimeUs: 0,
  updatesPerSec: 0,
  rendersPerSec: 0,
  maxParseTimeUs: 0,
  maxProcessTimeUs: 0,
  maxFlushTimeUs: 0,
  totalUpdates: 0,
  totalRenders: 0,
  uptimeSec: 0,
  snapshotParseTimeUs: 0,
  snapshotProcessTimeUs: 0,
};

const EMPTY: OrderbookState = {
  bids: [],
  asks: [],
  spread: 0,
  spreadPercent: 0,
  connected: false,
  lastUpdateTs: 0,
  perf: EMPTY_PERF,
};

type RawBook = Map<number, { price: number; count: number; amount: number }>;

// ── Perf tracker ───────────────────────────────────────────────

class PerfTracker {
  private parseTimes: number[] = [];
  private processTimes: number[] = [];
  private flushTimes: number[] = [];
  private updateCount = 0;
  private renderCount = 0;
  private secUpdateCount = 0;
  private secRenderCount = 0;
  private upsHistory: number[] = [];
  private rpsHistory: number[] = [];
  private maxParse = 0;
  private maxProcess = 0;
  private maxFlush = 0;
  private startTime = performance.now();
  snapshotParseUs = 0;
  snapshotProcessUs = 0;

  recordParse(us: number) {
    this.parseTimes.push(us);
    if (us > this.maxParse) this.maxParse = us;
    if (this.parseTimes.length > 500) this.parseTimes.shift();
  }

  recordProcess(us: number) {
    this.processTimes.push(us);
    if (us > this.maxProcess) this.maxProcess = us;
    if (this.processTimes.length > 500) this.processTimes.shift();
  }

  recordFlush(us: number) {
    this.flushTimes.push(us);
    if (us > this.maxFlush) this.maxFlush = us;
    if (this.flushTimes.length > 500) this.flushTimes.shift();
  }

  tickUpdate(count = 1) {
    this.updateCount += count;
    this.secUpdateCount += count;
  }

  tickRender() {
    this.renderCount++;
    this.secRenderCount++;
  }

  // Call once per second
  tick(): void {
    this.upsHistory.push(this.secUpdateCount);
    this.rpsHistory.push(this.secRenderCount);
    if (this.upsHistory.length > 30) this.upsHistory.shift();
    if (this.rpsHistory.length > 30) this.rpsHistory.shift();
    this.secUpdateCount = 0;
    this.secRenderCount = 0;
  }

  private avg(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  }

  getMetrics(): PerfMetrics {
    return {
      avgParseTimeUs: Math.round(this.avg(this.parseTimes) * 100) / 100,
      avgProcessTimeUs: Math.round(this.avg(this.processTimes) * 100) / 100,
      avgFlushTimeUs: Math.round(this.avg(this.flushTimes) * 100) / 100,
      updatesPerSec: this.upsHistory[this.upsHistory.length - 1] ?? 0,
      rendersPerSec: this.rpsHistory[this.rpsHistory.length - 1] ?? 0,
      maxParseTimeUs: Math.round(this.maxParse * 100) / 100,
      maxProcessTimeUs: Math.round(this.maxProcess * 100) / 100,
      maxFlushTimeUs: Math.round(this.maxFlush * 100) / 100,
      totalUpdates: this.updateCount,
      totalRenders: this.renderCount,
      uptimeSec: Math.round((performance.now() - this.startTime) / 1000),
      snapshotParseTimeUs: this.snapshotParseUs,
      snapshotProcessTimeUs: this.snapshotProcessUs,
    };
  }

  // Generate markdown benchmark report
  generateReport(): string {
    const m = this.getMetrics();
    const now = new Date().toISOString();
    return `## JS Bridge Benchmark — ${now}

| Metric | Value |
|--------|-------|
| **Runtime** | Hermes (React Native 0.81) |
| **Processing** | JavaScript (JSON.parse + Map + Array.sort) |
| **Uptime** | ${m.uptimeSec}s |
| **Total WS Updates** | ${m.totalUpdates.toLocaleString()} |
| **Total Renders** | ${m.totalRenders.toLocaleString()} |

### Throughput

| Metric | Value |
|--------|-------|
| Updates/sec (WS) | ${m.updatesPerSec} |
| Renders/sec (UI) | ${m.rendersPerSec} |
| Update:Render ratio | ${m.rendersPerSec > 0 ? (m.updatesPerSec / m.rendersPerSec).toFixed(1) : "N/A"}:1 |

### Latency (microseconds)

| Stage | Avg | Peak |
|-------|-----|------|
| JSON.parse | ${m.avgParseTimeUs} μs | ${m.maxParseTimeUs} μs |
| Process (sort+build) | ${m.avgProcessTimeUs} μs | ${m.maxProcessTimeUs} μs |
| setState flush | ${m.avgFlushTimeUs} μs | ${m.maxFlushTimeUs} μs |
| **Total per render** | **${(m.avgParseTimeUs + m.avgProcessTimeUs + m.avgFlushTimeUs).toFixed(1)} μs** | **${(m.maxParseTimeUs + m.maxProcessTimeUs + m.maxFlushTimeUs).toFixed(1)} μs** |

### Snapshot

| Metric | Value |
|--------|-------|
| Parse time | ${m.snapshotParseTimeUs} μs |
| Process time | ${m.snapshotProcessTimeUs} μs |

### Notes
- All timing uses \`performance.now()\` (ms precision, converted to μs)
- Parse = JSON.parse of raw WS message
- Process = applyUpdate to Map + buildSortedSide (sort + cumulative totals)
- Flush = setState call (does not include React reconciliation/render)
- UI throttled to ~20fps (50ms setTimeout) to batch WS updates
`;
  }
}

// ── Core logic ─────────────────────────────────────────────────

function buildSortedSide(
  book: RawBook,
  side: "bid" | "ask",
  depth: number
): OrderbookEntry[] {
  const entries = Array.from(book.values());
  if (side === "bid") {
    entries.sort((a, b) => b.price - a.price);
  } else {
    entries.sort((a, b) => a.price - b.price);
  }
  const trimmed = entries.slice(0, depth);
  let cumTotal = 0;
  return trimmed.map((e) => {
    cumTotal += e.amount;
    return { price: e.price, count: e.count, amount: e.amount, total: cumTotal };
  });
}

// Global perf tracker — accessible for report generation
let _perfTracker: PerfTracker | null = null;
export function getPerfTracker(): PerfTracker | null {
  return _perfTracker;
}

export function useOrderbook(
  symbol = "tBTCUSD",
  precision = "P0",
  depth = 20
): OrderbookState {
  const [state, setState] = useState<OrderbookState>(EMPTY);

  const bidsRef = useRef<RawBook>(new Map());
  const asksRef = useRef<RawBook>(new Map());
  const chanIdRef = useRef<number | null>(null);
  const perfRef = useRef<PerfTracker>(new PerfTracker());

  useEffect(() => {
    const perf = new PerfTracker();
    perfRef.current = perf;
    _perfTracker = perf;

    bidsRef.current.clear();
    asksRef.current.clear();
    chanIdRef.current = null;
    let destroyed = false;

    const applyUpdate = (price: number, count: number, amount: number) => {
      if (count === 0) {
        if (amount === 1) bidsRef.current.delete(price);
        else if (amount === -1) asksRef.current.delete(price);
      } else {
        const absAmount = Math.abs(amount);
        if (amount > 0) {
          bidsRef.current.set(price, { price, count, amount: absAmount });
        } else {
          asksRef.current.set(price, { price, count, amount: absAmount });
        }
      }
    };

    const doFlush = () => {
      const t0 = performance.now();
      const bids = buildSortedSide(bidsRef.current, "bid", depth);
      const asks = buildSortedSide(asksRef.current, "ask", depth);
      const bestBid = bids[0]?.price ?? 0;
      const bestAsk = asks[0]?.price ?? 0;
      const spread = bestAsk - bestBid;
      const mid = (bestAsk + bestBid) / 2;
      const processUs = (performance.now() - t0) * 1000;
      perf.recordProcess(processUs);

      const t1 = performance.now();
      setState({
        bids,
        asks,
        spread,
        spreadPercent: mid > 0 ? (spread / mid) * 100 : 0,
        connected: true,
        lastUpdateTs: Date.now(),
        perf: perf.getMetrics(),
      });
      const flushUs = (performance.now() - t1) * 1000;
      perf.recordFlush(flushUs);
      perf.tickRender();
    };

    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let dirty = false;

    const scheduleFlush = () => {
      dirty = true;
      if (flushTimer === null) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          if (dirty) {
            dirty = false;
            doFlush();
          }
        }, 50);
      }
    };

    // Perf tick every second
    const perfInterval = setInterval(() => {
      perf.tick();
      // Update metrics in state
      setState((prev) => ({ ...prev, perf: perf.getMetrics() }));
    }, 1000);

    // Log benchmark report every 30s
    const reportInterval = setInterval(() => {
      console.log("\n" + perf.generateReport());
    }, 30000);

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (destroyed) return;
      console.log("[orderbook] WS connecting...");
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log("[orderbook] WS connected, subscribing...");
        ws?.send(
          JSON.stringify({
            event: "subscribe",
            channel: "book",
            symbol,
            prec: precision,
            freq: "F0",
            len: String(depth <= 25 ? 25 : 100),
          })
        );
      };

      ws.onmessage = (event: any) => {
        try {
          const t0 = performance.now();
          const raw =
            typeof event.data === "string" ? event.data : String(event.data);
          const data = JSON.parse(raw);
          const parseUs = (performance.now() - t0) * 1000;

          if (data.event) {
            if (data.event === "subscribed" && data.channel === "book") {
              chanIdRef.current = data.chanId;
              console.log("[orderbook] subscribed chanId:", data.chanId);
            }
            return;
          }

          if (!Array.isArray(data) || data.length < 2) return;
          const [chanId, payload] = data;
          if (chanId !== chanIdRef.current) return;
          if (payload === "hb") return;

          // Snapshot
          if (Array.isArray(payload) && Array.isArray(payload[0])) {
            perf.snapshotParseUs = Math.round(parseUs * 100) / 100;
            const t1 = performance.now();
            bidsRef.current.clear();
            asksRef.current.clear();
            for (const [p, c, a] of payload) applyUpdate(p, c, a);
            perf.snapshotProcessUs =
              Math.round((performance.now() - t1) * 1000 * 100) / 100;
            perf.tickUpdate(payload.length);
            console.log(
              `[perf] snapshot: parse=${perf.snapshotParseUs}μs process=${perf.snapshotProcessUs}μs entries=${payload.length}`
            );
            scheduleFlush();
            return;
          }

          // Single update
          if (Array.isArray(payload) && typeof payload[0] === "number") {
            perf.recordParse(parseUs);
            applyUpdate(payload[0], payload[1], payload[2]);
            perf.tickUpdate();
            scheduleFlush();
          }
        } catch (err) {
          console.warn("[orderbook] parse error:", err);
        }
      };

      ws.onerror = (e: any) => {
        console.log("[orderbook] WS error:", e?.message || "");
      };

      ws.onclose = () => {
        console.log("[orderbook] WS closed, reconnecting in 2s...");
        setState((prev) => ({ ...prev, connected: false }));
        if (!destroyed) {
          reconnectTimer = setTimeout(connect, 2000);
        }
      };
    };

    connect();

    return () => {
      destroyed = true;
      // Log final report on unmount
      console.log("\n=== FINAL BENCHMARK REPORT ===\n" + perf.generateReport());
      clearInterval(perfInterval);
      clearInterval(reportInterval);
      if (flushTimer !== null) clearTimeout(flushTimer);
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      ws?.close();
      _perfTracker = null;
    };
  }, [symbol, precision, depth]);

  return state;
}

// ── Formatters ─────────────────────────────────────────────────

export function formatPrice(price: number): string {
  return price.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

export function formatAmount(amount: number): string {
  if (amount >= 1) return amount.toFixed(4);
  return amount.toFixed(6);
}

export function formatTotal(total: number): string {
  return total.toFixed(4);
}
