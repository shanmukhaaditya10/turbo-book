import NativeOrderbookEngine from "./NativeOrderbookEngine";

if (!NativeOrderbookEngine) {
  console.warn(
    "[OrderbookEngine] Native module not found. Did you rebuild the native app?"
  );
}

export default NativeOrderbookEngine;
export type { Spec as OrderbookEngineSpec } from "./NativeOrderbookEngine";
