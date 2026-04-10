/**
 * TurboModule-backed orderbook hook.
 * Replaces lib/orderbook.ts (JS engine) with C++ processing via JSI.
 *
 * Key differences from JS version:
 * - No Map/sort in JS — C++ std::map keeps levels sorted automatically
 * - No JSON.parse overhead for snapshot data — flat array goes directly to C++
 * - getTopLevels() is a synchronous JSI call (no bridge crossing)
 * - setState is still the flush mechanism (React requirement)
 */
import { useEffect, useRef, useState } from "react";
import OrderbookEngine from "./orderbook-engine";

const WS_URL = "wss://api-pub.bitfinex.com/ws/2";

export type OrderbookEntry = {
  price: number;
  count: number;
  amount: number;
  total: number;
};

export type PerfMetrics = {
  avgParseTimeUs: number;
  avgProcessTimeUs: number;
  avgFlushTimeUs: number;
  updatesPerSec: number;
  rendersPerSec: number;
  maxParseTimeUs: number;
  maxProcessTimeUs: number;
  maxFlushTimeUs: number;
  totalUpdates: number;
  totalRenders: number;
  uptimeSec: number;
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

  generateReport(): string {
    const m = this.getMetrics();
    const now = new Date().toISOString();
    return `## C++ TurboModule Benchmark — ${now}

| Metric | Value |
|--------|-------|
| **Runtime** | Hermes + C++ TurboModule (JSI) |
| **Processing** | C++ (std::map + top-N extraction via JSI) |
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
| C++ process (JSI) | ${m.avgProcessTimeUs} μs | ${m.maxProcessTimeUs} μs |
| setState flush | ${m.avgFlushTimeUs} μs | ${m.maxFlushTimeUs} μs |
| **Total per render** | **${(m.avgParseTimeUs + m.avgProcessTimeUs + m.avgFlushTimeUs).toFixed(1)} μs** | **${(m.maxParseTimeUs + m.maxProcessTimeUs + m.maxFlushTimeUs).toFixed(1)} μs** |

### Snapshot

| Metric | Value |
|--------|-------|
| Parse time | ${m.snapshotParseTimeUs} μs |
| Process time | ${m.snapshotProcessTimeUs} μs |

### Notes
- Parse = JSON.parse of raw WS message (still needed for WS protocol)
- Process = C++ processDelta/processSnapshot + getTopLevels via synchronous JSI call
- Flush = setState call (React requirement, not bridge-related)
- UI throttled to ~20fps (50ms setTimeout) to batch WS updates
`;
  }
}

let _perfTracker: PerfTracker | null = null;
export function getPerfTracker(): PerfTracker | null {
  return _perfTracker;
}

// ── Hook ────────────────────────────────────────────────────────

export function useOrderbook(
  symbol = "tBTCUSD",
  precision = "P0",
  depth = 20
): OrderbookState {
  const [state, setState] = useState<OrderbookState>(EMPTY);
  const chanIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!OrderbookEngine) {
      console.error("[orderbook] TurboModule not available!");
      return;
    }

    const engine = OrderbookEngine;
    const perf = new PerfTracker();
    _perfTracker = perf;
    engine.reset();
    chanIdRef.current = null;
    let destroyed = false;

    const doFlush = () => {
      const t0 = performance.now();
      // Synchronous JSI call — no bridge crossing
      const top = engine.getTopLevels(depth);
      const bids: OrderbookEntry[] = top.bids.map((r) => ({
        price: r[0],
        count: r[1],
        amount: r[2],
        total: r[3],
      }));
      const asks: OrderbookEntry[] = top.asks.map((r) => ({
        price: r[0],
        count: r[1],
        amount: r[2],
        total: r[3],
      }));
      const processUs = (performance.now() - t0) * 1000;
      perf.recordProcess(processUs);

      const bestBid = bids[0]?.price ?? 0;
      const bestAsk = asks[0]?.price ?? 0;
      const spread = bestAsk - bestBid;
      const mid = (bestAsk + bestBid) / 2;

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

    const perfInterval = setInterval(() => {
      perf.tick();
      setState((prev) => ({ ...prev, perf: perf.getMetrics() }));
    }, 1000);

    const reportInterval = setInterval(() => {
      console.log("\n" + perf.generateReport());
    }, 30000);

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (destroyed) return;
      console.log("[orderbook-native] WS connecting...");
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log("[orderbook-native] WS connected, subscribing...");
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
              console.log("[orderbook-native] subscribed chanId:", data.chanId);
            }
            return;
          }

          if (!Array.isArray(data) || data.length < 2) return;
          const [chanId, payload] = data;
          if (chanId !== chanIdRef.current) return;
          if (payload === "hb") return;

          // Snapshot: [[price, count, amount], ...]
          if (Array.isArray(payload) && Array.isArray(payload[0])) {
            perf.snapshotParseUs = Math.round(parseUs * 100) / 100;
            const t1 = performance.now();
            // Flatten to [p,c,a, p,c,a, ...] for C++ processSnapshot
            const flat: number[] = new Array(payload.length * 3);
            for (let i = 0; i < payload.length; i++) {
              flat[i * 3] = payload[i][0];
              flat[i * 3 + 1] = payload[i][1];
              flat[i * 3 + 2] = payload[i][2];
            }
            engine.processSnapshot(flat);
            perf.snapshotProcessUs =
              Math.round((performance.now() - t1) * 1000 * 100) / 100;
            perf.tickUpdate(payload.length);
            console.log(
              `[perf-native] snapshot: parse=${perf.snapshotParseUs}μs process=${perf.snapshotProcessUs}μs entries=${payload.length}`
            );
            scheduleFlush();
            return;
          }

          // Single delta: [price, count, amount]
          if (Array.isArray(payload) && typeof payload[0] === "number") {
            perf.recordParse(parseUs);
            engine.processDelta(payload[0], payload[1], payload[2]);
            perf.tickUpdate();
            scheduleFlush();
          }
        } catch (err) {
          console.warn("[orderbook-native] parse error:", err);
        }
      };

      ws.onerror = (e: any) => {
        console.log("[orderbook-native] WS error:", e?.message || "");
      };

      ws.onclose = () => {
        console.log("[orderbook-native] WS closed, reconnecting in 2s...");
        setState((prev) => ({ ...prev, connected: false }));
        if (!destroyed) {
          reconnectTimer = setTimeout(connect, 2000);
        }
      };
    };

    connect();

    return () => {
      destroyed = true;
      console.log(
        "\n=== FINAL NATIVE BENCHMARK ===\n" + perf.generateReport()
      );
      clearInterval(perfInterval);
      clearInterval(reportInterval);
      if (flushTimer !== null) clearTimeout(flushTimer);
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      ws?.close();
      engine.reset();
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
