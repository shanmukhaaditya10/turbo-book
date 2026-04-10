import { useEffect, useRef, useState } from "react";
import OrderbookEngine from "./orderbook-engine";

// ── Types ──────────────────────────────────────────────────────────

export type OrderbookEntry = {
  price: number;
  count: number;
  amount: number;
  total: number;  // cumulative size from best price to this level
};

export type OrderbookState = {
  bids: OrderbookEntry[];
  asks: OrderbookEntry[];
  spread: number;
  spreadPercent: number;
  connected: boolean;
  perf: {
    updatesPerSec: number;
    totalUpdates: number;
    avgLatencyUs: number;  // avg time to fetch + parse levels from native (microseconds)
  };
};

const EMPTY_STATE: OrderbookState = {
  bids: [],
  asks: [],
  spread: 0,
  spreadPercent: 0,
  connected: false,
  perf: { updatesPerSec: 0, totalUpdates: 0, avgLatencyUs: 0 },
};

export type MultiOrderbookState = Record<string, OrderbookState>;

// ── Hook ───────────────────────────────────────────────────────────
// Manages live orderbooks for multiple symbols using one native WebSocket.
// JS polls the C++ engine every 50ms — only re-renders when new data arrives.

export function useMultiOrderbook(symbols: string[], depth = 10): MultiOrderbookState {
  const [state, setState] = useState<MultiOrderbookState>(
    Object.fromEntries(symbols.map((s) => [s, EMPTY_STATE]))
  );

  // Track the last update count we rendered — skip re-render if unchanged
  const lastCounts = useRef<Record<string, number>>({});

  // Rolling latency average per symbol (last 60 samples)
  const latencySamples = useRef<Record<string, number[]>>({});

  // Updates-per-second tracking
  const prevCounts  = useRef<Record<string, number>>({});
  const upsRef      = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!OrderbookEngine) {
      console.error("[TurboBook] TurboModule not available");
      return;
    }

    // Reset tracking state for each symbol
    symbols.forEach((sym) => {
      lastCounts.current[sym]     = 0;
      prevCounts.current[sym]     = 0;
      upsRef.current[sym]         = 0;
      latencySamples.current[sym] = [];
    });

    OrderbookEngine.connectMulti(symbols, "P0", "F0", "25");

    // ── Poll every 50ms ────────────────────────────────────────────
    // For each symbol: check if totalUpdates changed. If yes, fetch levels and re-render.
    const poll = setInterval(() => {
      const updates: Partial<MultiOrderbookState> = {};
      let anyChanged = false;

      for (const sym of symbols) {
        const { totalUpdates } = OrderbookEngine!.getTimings(sym);
        const connected = OrderbookEngine!.isConnected(sym) as unknown as boolean;

        // Nothing new — just sync the connected dot if it changed
        if (totalUpdates === lastCounts.current[sym]) {
          setState((prev) => {
            if (prev[sym]?.connected === connected) return prev;
            return { ...prev, [sym]: { ...prev[sym], connected } };
          });
          continue;
        }

        lastCounts.current[sym] = totalUpdates;
        anyChanged = true;

        // Time the JSI call so we can show it in the UI
        const t0   = performance.now();
        const flat = OrderbookEngine!.getTopLevels(sym, depth) as unknown as number[];
        const latencyUs = (performance.now() - t0) * 1000;

        // Track a rolling average of the last 60 latency samples
        const samples = latencySamples.current[sym];
        samples.push(latencyUs);
        if (samples.length > 60) samples.shift();
        const avgLatencyUs = samples.reduce((a, b) => a + b, 0) / samples.length;

        // Parse flat array: [bidCount, askCount, price, count, amount, total, ...]
        const bidCount = flat[0];
        const askCount = flat[1];
        const bids: OrderbookEntry[] = [];
        const asks: OrderbookEntry[] = [];
        let i = 2;
        for (let b = 0; b < bidCount; b++, i += 4)
          bids.push({ price: flat[i], count: flat[i+1], amount: flat[i+2], total: flat[i+3] });
        for (let a = 0; a < askCount; a++, i += 4)
          asks.push({ price: flat[i], count: flat[i+1], amount: flat[i+2], total: flat[i+3] });

        const bestBid = bids[0]?.price ?? 0;
        const bestAsk = asks[0]?.price ?? 0;
        const spread  = bestAsk - bestBid;
        const mid     = (bestBid + bestAsk) / 2;

        updates[sym] = {
          bids, asks, spread, connected,
          spreadPercent: mid > 0 ? (spread / mid) * 100 : 0,
          perf: { updatesPerSec: upsRef.current[sym], totalUpdates, avgLatencyUs },
        };
      }

      if (anyChanged) setState((prev) => ({ ...prev, ...updates }));
    }, 50);

    // ── Count updates per second ───────────────────────────────────
    const upsTick = setInterval(() => {
      symbols.forEach((sym) => {
        const { totalUpdates } = OrderbookEngine!.getTimings(sym);
        upsRef.current[sym]  = totalUpdates - prevCounts.current[sym];
        prevCounts.current[sym] = totalUpdates;
      });
    }, 1000);

    return () => {
      clearInterval(poll);
      clearInterval(upsTick);
      OrderbookEngine!.disconnect();
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
  return amount >= 1 ? amount.toFixed(4) : amount.toFixed(6);
}
