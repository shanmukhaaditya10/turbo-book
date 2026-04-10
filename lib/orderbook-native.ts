/**
 * TurboModule multi-symbol orderbook hook.
 * ONE native WebSocket, N C++ engines, JS polls dirty state only.
 */
import { useEffect, useRef, useState } from "react";
import OrderbookEngine from "./orderbook-engine";

export type OrderbookEntry = {
  price: number;
  count: number;
  amount: number;
  total: number;
};

export type SymbolPerf = {
  updatesPerSec: number;
  rendersPerSec: number;
  totalUpdates: number;
  avgGetTopLevelsUs: number;
  avgFlushTimeUs: number;
};

export type OrderbookState = {
  bids: OrderbookEntry[];
  asks: OrderbookEntry[];
  spread: number;
  spreadPercent: number;
  connected: boolean;
  perf: SymbolPerf;
};

const EMPTY_PERF: SymbolPerf = {
  updatesPerSec: 0,
  rendersPerSec: 0,
  totalUpdates: 0,
  avgGetTopLevelsUs: 0,
  avgFlushTimeUs: 0,
};

const EMPTY_STATE: OrderbookState = {
  bids: [],
  asks: [],
  spread: 0,
  spreadPercent: 0,
  connected: false,
  perf: EMPTY_PERF,
};

// ── Per-symbol tracker ─────────────────────────────────────────────

class SymbolTracker {
  private getTopLevelsTimes: number[] = [];
  private flushTimes: number[]        = [];
  private renderCount   = 0;
  private secRenderCount = 0;
  private rpsHistory: number[] = [];
  private prevUpdates = 0;
  private upsHistory: number[] = [];

  private push(arr: number[], v: number) {
    arr.push(v);
    if (arr.length > 200) arr.shift();
  }

  private avg(arr: number[]): number {
    if (!arr.length) return 0;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  }

  recordGetTopLevels(us: number) { this.push(this.getTopLevelsTimes, us); }
  recordFlush(us: number)        { this.push(this.flushTimes, us); }

  tickRender() {
    this.renderCount++;
    this.secRenderCount++;
  }

  tickSecond(currentUpdates: number) {
    this.upsHistory.push(currentUpdates - this.prevUpdates);
    this.rpsHistory.push(this.secRenderCount);
    this.prevUpdates   = currentUpdates;
    this.secRenderCount = 0;
    if (this.upsHistory.length > 30) this.upsHistory.shift();
    if (this.rpsHistory.length > 30) this.rpsHistory.shift();
  }

  getPerf(totalUpdates: number): SymbolPerf {
    return {
      updatesPerSec:     this.upsHistory[this.upsHistory.length - 1] ?? 0,
      rendersPerSec:     this.rpsHistory[this.rpsHistory.length - 1] ?? 0,
      totalUpdates,
      avgGetTopLevelsUs: Math.round(this.avg(this.getTopLevelsTimes) * 100) / 100,
      avgFlushTimeUs:    Math.round(this.avg(this.flushTimes)        * 100) / 100,
    };
  }
}

// ── Multi-symbol hook ──────────────────────────────────────────────

export type MultiOrderbookState = Record<string, OrderbookState>;

export function useMultiOrderbook(
  symbols: string[],
  depth = 10
): MultiOrderbookState {
  const emptyState = Object.fromEntries(symbols.map((s) => [s, EMPTY_STATE]));
  const [state, setState] = useState<MultiOrderbookState>(emptyState);
  const lastUpdateCounts = useRef<Record<string, number>>({});
  const trackers = useRef<Record<string, SymbolTracker>>({});

  useEffect(() => {
    if (!OrderbookEngine) {
      console.error("[orderbook-native] TurboModule not available!");
      return;
    }

    const engine = OrderbookEngine;

    // Init per-symbol trackers and dirty counters
    symbols.forEach((sym) => {
      lastUpdateCounts.current[sym] = 0;
      trackers.current[sym] = new SymbolTracker();
    });

    engine.connectMulti(symbols, "P0", "F0", "25");

    // ── 50ms poll — dirty check per symbol ───────────────────────
    const pollInterval = setInterval(() => {
      const updates: Partial<MultiOrderbookState> = {};
      let anyChanged = false;

      for (const sym of symbols) {
        const timings = engine.getTimings(sym);
        const connected = engine.isConnected(sym) as unknown as boolean;
        const tracker = trackers.current[sym];

        if (timings.totalUpdates === lastUpdateCounts.current[sym]) {
          // No new data — update connected flag only if it changed
          setState((prev) => {
            if (prev[sym]?.connected === connected) return prev;
            return { ...prev, [sym]: { ...prev[sym], connected } };
          });
          continue;
        }

        lastUpdateCounts.current[sym] = timings.totalUpdates;
        anyChanged = true;

        const t0   = performance.now();
        const flat = engine.getTopLevels(sym, depth) as unknown as number[];
        const getTopLevelsUs = (performance.now() - t0) * 1000;
        tracker.recordGetTopLevels(getTopLevelsUs);

        const bidCount = flat[0] as unknown as number;
        const askCount = flat[1] as unknown as number;
        const bids: OrderbookEntry[] = [];
        const asks: OrderbookEntry[] = [];
        let offset = 2;
        for (let i = 0; i < bidCount; i++, offset += 4) {
          bids.push({
            price: flat[offset] as unknown as number,
            count: flat[offset + 1] as unknown as number,
            amount: flat[offset + 2] as unknown as number,
            total: flat[offset + 3] as unknown as number,
          });
        }
        for (let i = 0; i < askCount; i++, offset += 4) {
          asks.push({
            price: flat[offset] as unknown as number,
            count: flat[offset + 1] as unknown as number,
            amount: flat[offset + 2] as unknown as number,
            total: flat[offset + 3] as unknown as number,
          });
        }

        const bestBid = bids[0]?.price ?? 0;
        const bestAsk = asks[0]?.price ?? 0;
        const spread  = bestAsk - bestBid;
        const mid     = (bestBid + bestAsk) / 2;

        tracker.tickRender();
        const t1 = performance.now();
        updates[sym] = {
          bids, asks, spread, connected,
          spreadPercent: mid > 0 ? (spread / mid) * 100 : 0,
          perf: tracker.getPerf(timings.totalUpdates),
        };
        tracker.recordFlush((performance.now() - t1) * 1000);
      }

      if (anyChanged) {
        setState((prev) => ({ ...prev, ...updates }));
      }
    }, 50);

    // ── Per-second UPS tracking ───────────────────────────────────
    const secInterval = setInterval(() => {
      symbols.forEach((sym) => {
        const timings = engine.getTimings(sym);
        trackers.current[sym]?.tickSecond(timings.totalUpdates);
      });
    }, 1000);

    // ── 30s benchmark report ──────────────────────────────────────
    const reportInterval = setInterval(() => {
      const lines = symbols.map((sym) => {
        const t = engine.getTimings(sym);
        const p = trackers.current[sym]?.getPerf(t.totalUpdates);
        return `${sym}: ${t.totalUpdates} updates | ${p?.avgGetTopLevelsUs}μs JSI | ${p?.avgFlushTimeUs}μs flush`;
      });
      console.log(`\n[NATIVE BENCHMARK]\n${lines.join("\n")}`);
    }, 30000);

    return () => {
      clearInterval(pollInterval);
      clearInterval(secInterval);
      clearInterval(reportInterval);
      engine.disconnect();
    };
  }, [symbols.join(","), depth]);

  return state;
}

// ── Formatters ─────────────────────────────────────────────────────

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
