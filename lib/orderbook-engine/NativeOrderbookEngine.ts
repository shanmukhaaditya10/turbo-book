import { TurboModule, TurboModuleRegistry } from "react-native";

export interface Spec extends TurboModule {
  /**
   * Open ONE native WebSocket and subscribe to multiple symbols simultaneously.
   * symbols e.g. ["tBTCUSD", "tETHUSD", "tXRPUSD"]
   */
  connectMulti(symbols: string[], prec: string, freq: string, len: string): void;

  /** Close the WebSocket and tear down all engines. */
  disconnect(): void;

  /**
   * Get top N levels for a specific symbol as a flat array.
   * Format: [bidCount, askCount, p,c,a,t per bid..., p,c,a,t per ask...]
   */
  getTopLevels(symbol: string, n: number): number[];

  /**
   * Internal timing breakdown for a specific symbol.
   * mapTraversalUs: C++ std::map iteration time
   * arrayBuildUs:   ObjC NSMutableArray construction time
   * totalUpdates:   cumulative WS updates for this symbol
   */
  getTimings(symbol: string): {
    mapTraversalUs: number;
    arrayBuildUs: number;
    totalUpdates: number;
  };

  /** True if this symbol is subscribed and receiving data. */
  isConnected(symbol: string): boolean;
}

export default TurboModuleRegistry.get<Spec>("OrderbookEngine") as Spec | null;
