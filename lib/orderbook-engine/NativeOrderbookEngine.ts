import { TurboModule, TurboModuleRegistry } from "react-native";

/**
 * Pure C++ TurboModule for orderbook processing.
 * Registered via registerCxxModuleToGlobalModuleMap (no codegen).
 */
export interface Spec extends TurboModule {
  /**
   * Process a full orderbook snapshot.
   * @param data Flat array: [price, count, amount, price, count, amount, ...]
   */
  processSnapshot(data: number[]): void;

  /**
   * Process a single delta update.
   * count=0 → delete (amount=1 bid, amount=-1 ask)
   * count>0 → upsert (amount>0 bid, amount<0 ask)
   */
  processDelta(price: number, count: number, amount: number): void;

  /** Clear all levels from both sides. */
  reset(): void;

  /**
   * Get top N levels from each side, pre-sorted with cumulative totals.
   * Returns { bids: number[][], asks: number[][] }
   * Each row: [price, count, amount, cumulativeTotal]
   */
  getTopLevels(n: number): {
    bids: number[][];
    asks: number[][];
  };

  /** CRC32 checksum matching Bitfinex format. */
  getChecksum(): number;
}

export default TurboModuleRegistry.get<Spec>("OrderbookEngine") as Spec | null;
