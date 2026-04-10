import { TurboModule, TurboModuleRegistry } from "react-native";

export interface Spec extends TurboModule {
  /** Open one native WebSocket and subscribe to multiple symbols. */
  connectMulti(symbols: string[], prec: string, freq: string, len: string): void;

  /** Close the WebSocket and tear down all engines. */
  disconnect(): void;

  /**
   * Get the top N price levels for a symbol.
   * Returns a flat array: [bidCount, askCount, price, count, amount, total, ...]
   */
  getTopLevels(symbol: string, n: number): number[];

  /**
   * Returns how many updates a symbol has received.
   * JS uses totalUpdates as a cheap dirty check before calling getTopLevels.
   */
  getTimings(symbol: string): { totalUpdates: number };

  /** True if this symbol has an active subscription. */
  isConnected(symbol: string): boolean;
}

export default TurboModuleRegistry.get<Spec>("OrderbookEngine") as Spec | null;
