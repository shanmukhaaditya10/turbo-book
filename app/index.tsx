import {
  View,
  Text,
  ScrollView,
  Switch,
  Pressable,
  Alert,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useState, useMemo } from "react";

import {
  useMultiOrderbook,
  formatPrice,
  formatAmount,
  type OrderbookEntry,
  type OrderbookState,
} from "../lib/orderbook-native";
import { useOrderbook } from "../lib/orderbook";

// ── Constants ──────────────────────────────────────────────────────

const SYMBOLS = ["tBTCUSD", "tETHUSD", "tXRPUSD"];
const LABELS: Record<string, string> = {
  tBTCUSD: "BTC/USD",
  tETHUSD: "ETH/USD",
  tXRPUSD: "XRP/USD",
};
const DEPTH = 7;

// ── Single JS orderbook panel (3 separate WebSockets) ─────────────

function JSBookPanel({ symbol }: { symbol: string }) {
  const book = useOrderbook(symbol, "P0", DEPTH);
  return <BookPanel label={LABELS[symbol]} book={book} mode="JS" />;
}

// ── Native multi-book consumer ─────────────────────────────────────

function NativeBookPanel({
  symbol,
  books,
}: {
  symbol: string;
  books: Record<string, OrderbookState>;
}) {
  const book = books[symbol] ?? {
    bids: [],
    asks: [],
    spread: 0,
    spreadPercent: 0,
    connected: false,
    perf: { updatesPerSec: 0, rendersPerSec: 0, totalUpdates: 0, avgGetTopLevelsUs: 0, avgFlushTimeUs: 0 },
  };
  return <BookPanel label={LABELS[symbol]} book={book} mode="NATIVE" />;
}

// ── Shared book panel ──────────────────────────────────────────────

function PriceRow({
  entry,
  side,
  maxTotal,
}: {
  entry: OrderbookEntry;
  side: "bid" | "ask";
  maxTotal: number;
}) {
  const pct = maxTotal > 0 ? (entry.total / maxTotal) * 100 : 0;
  const barColor = side === "bid" ? "#16a34a22" : "#dc262622";
  const priceColor = side === "bid" ? "#4ade80" : "#f87171";

  return (
    <View style={{ flexDirection: "row", alignItems: "center", height: 22, position: "relative" }}>
      <View
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: `${pct}%`,
          backgroundColor: barColor,
        }}
      />
      <Text style={{ flex: 1, color: priceColor, fontSize: 11, fontVariant: ["tabular-nums"], fontWeight: "600" }}>
        {formatPrice(entry.price)}
      </Text>
      <Text style={{ flex: 1, color: "#9ca3af", fontSize: 10, fontVariant: ["tabular-nums"], textAlign: "right" }}>
        {formatAmount(entry.amount)}
      </Text>
    </View>
  );
}

function BookPanel({
  label,
  book,
  mode,
}: {
  label: string;
  book: OrderbookState;
  mode: "JS" | "NATIVE";
}) {
  const maxBidTotal = book.bids[book.bids.length - 1]?.total ?? 1;
  const maxAskTotal = book.asks[book.asks.length - 1]?.total ?? 1;

  const perf = book.perf as any;
  const upsLabel = perf.updatesPerSec ?? 0;
  const totalUp  = perf.totalUpdates ?? 0;
  const jsTime   = mode === "JS"
    ? ((perf.avgProcessTimeUs ?? 0) + (perf.avgFlushTimeUs ?? 0)).toFixed(0)
    : ((perf.avgGetTopLevelsUs ?? 0) + (perf.avgFlushTimeUs ?? 0)).toFixed(0);

  return (
    <View
      style={{
        backgroundColor: "#0f172a",
        borderRadius: 12,
        padding: 10,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: book.connected ? "#1e3a5f" : "#374151",
      }}
    >
      {/* Header */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <Text style={{ color: "#e2e8f0", fontWeight: "700", fontSize: 13 }}>{label}</Text>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Text style={{ color: "#94a3b8", fontSize: 10 }}>
            {upsLabel} upd/s · {jsTime}μs
          </Text>
          <View style={{
            width: 7, height: 7, borderRadius: 4,
            backgroundColor: book.connected ? "#22c55e" : "#ef4444",
          }} />
        </View>
      </View>

      {/* Spread */}
      {book.spread > 0 && (
        <Text style={{ color: "#facc15", fontSize: 9, textAlign: "center", marginBottom: 4 }}>
          spread ${formatPrice(book.spread)} ({book.spreadPercent.toFixed(4)}%)
        </Text>
      )}

      {/* Column headers */}
      <View style={{ flexDirection: "row", marginBottom: 2 }}>
        <Text style={{ flex: 1, color: "#475569", fontSize: 9 }}>PRICE</Text>
        <Text style={{ flex: 1, color: "#475569", fontSize: 9, textAlign: "right" }}>SIZE</Text>
      </View>

      {/* Asks (reversed: lowest ask at bottom, closest to spread) */}
      {[...book.asks].reverse().map((e, i) => (
        <PriceRow key={`a${i}`} entry={e} side="ask" maxTotal={maxAskTotal} />
      ))}

      {/* Spread divider */}
      <View style={{ height: 1, backgroundColor: "#1e293b", marginVertical: 3 }} />

      {/* Bids */}
      {book.bids.map((e, i) => (
        <PriceRow key={`b${i}`} entry={e} side="bid" maxTotal={maxBidTotal} />
      ))}

      {/* Footer */}
      <Text style={{ color: "#334155", fontSize: 8, marginTop: 4, textAlign: "right" }}>
        {totalUp.toLocaleString()} total updates
      </Text>
    </View>
  );
}

// ── Native container (one hook manages all 3 books) ───────────────

function NativeBooks() {
  const books = useMultiOrderbook(SYMBOLS, DEPTH);
  return (
    <>
      {SYMBOLS.map((sym) => (
        <NativeBookPanel key={sym} symbol={sym} books={books} />
      ))}
    </>
  );
}

// ── JS container (3 independent hooks = 3 WebSockets) ─────────────

function JSBooks() {
  return (
    <>
      {SYMBOLS.map((sym) => (
        <JSBookPanel key={sym} symbol={sym} />
      ))}
    </>
  );
}

// ── Root ───────────────────────────────────────────────────────────

export default function App() {
  const [useNative, setUseNative] = useState(true);

  return (
    <View style={{ flex: 1, backgroundColor: "#020817" }}>
      <StatusBar style="light" />

      {/* Header */}
      <View
        style={{
          paddingTop: 56,
          paddingHorizontal: 16,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: "#1e293b",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <View>
          <Text style={{ color: "#f8fafc", fontSize: 18, fontWeight: "800" }}>
            TurboBook
          </Text>
          <Text style={{ color: "#64748b", fontSize: 11, marginTop: 1 }}>
            {SYMBOLS.map((s) => LABELS[s]).join(" · ")}
          </Text>
        </View>

        {/* JS / NATIVE toggle */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: useNative ? "#475569" : "#22d3ee", fontSize: 12, fontWeight: "600" }}>
            JS
          </Text>
          <Switch
            value={useNative}
            onValueChange={setUseNative}
            thumbColor={useNative ? "#6366f1" : "#22d3ee"}
            trackColor={{ false: "#1e3a5f", true: "#312e81" }}
          />
          <Text style={{ color: useNative ? "#818cf8" : "#475569", fontSize: 12, fontWeight: "600" }}>
            NATIVE
          </Text>
        </View>
      </View>

      {/* Mode badge */}
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <View
          style={{
            backgroundColor: useNative ? "#1e1b4b" : "#0c2240",
            borderRadius: 8,
            padding: 8,
            flexDirection: "row",
            justifyContent: "space-between",
          }}
        >
          <Text style={{ color: useNative ? "#818cf8" : "#38bdf8", fontSize: 11, fontWeight: "700" }}>
            {useNative
              ? "C++ TurboModule · 1 native WS · 3 engines"
              : "Pure JS · 3 WebSockets · Map + sort per update"}
          </Text>
          <Text style={{ color: "#475569", fontSize: 10 }}>
            depth {DEPTH}
          </Text>
        </View>
      </View>

      {/* Books */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      >
        {useNative ? <NativeBooks /> : <JSBooks />}
      </ScrollView>
    </View>
  );
}
