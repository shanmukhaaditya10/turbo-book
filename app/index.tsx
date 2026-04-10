import {
  View,
  Text,
  ScrollView,
} from "react-native";
import { StatusBar } from "expo-status-bar";

import {
  useMultiOrderbook,
  formatPrice,
  formatAmount,
  type OrderbookEntry,
  type OrderbookState,
} from "../lib/orderbook-native";

// ── Constants ──────────────────────────────────────────────────────

const SYMBOLS = ["tBTCUSD", "tETHUSD", "tXRPUSD"];
const LABELS: Record<string, string> = {
  tBTCUSD: "BTC/USD",
  tETHUSD: "ETH/USD",
  tXRPUSD: "XRP/USD",
};
const DEPTH = 7;

// ── Price row ──────────────────────────────────────────────────────

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

// ── Book panel ─────────────────────────────────────────────────────

function BookPanel({
  label,
  book,
}: {
  label: string;
  book: OrderbookState;
}) {
  const maxBidTotal = book.bids[book.bids.length - 1]?.total ?? 1;
  const maxAskTotal = book.asks[book.asks.length - 1]?.total ?? 1;

  const perf = book.perf;
  const upsLabel = perf.updatesPerSec ?? 0;
  const latencyUs = ((perf.avgGetTopLevelsUs ?? 0) + (perf.avgFlushTimeUs ?? 0)).toFixed(0);

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
            {upsLabel} upd/s · {latencyUs}μs
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
        {perf.totalUpdates.toLocaleString()} total updates
      </Text>
    </View>
  );
}

// ── Books container ────────────────────────────────────────────────

function Books() {
  const books = useMultiOrderbook(SYMBOLS, DEPTH);
  return (
    <>
      {SYMBOLS.map((sym) => {
        const book = books[sym] ?? {
          bids: [],
          asks: [],
          spread: 0,
          spreadPercent: 0,
          connected: false,
          perf: { updatesPerSec: 0, rendersPerSec: 0, totalUpdates: 0, avgGetTopLevelsUs: 0, avgFlushTimeUs: 0 },
        };
        return <BookPanel key={sym} label={LABELS[sym]} book={book} />;
      })}
    </>
  );
}

// ── Root ───────────────────────────────────────────────────────────

export default function App() {
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
        }}
      >
        <Text style={{ color: "#f8fafc", fontSize: 20, fontWeight: "800" }}>
          TurboBook
        </Text>
        <Text style={{ color: "#64748b", fontSize: 11, marginTop: 2 }}>
          Real-time market depth · {SYMBOLS.map((s) => LABELS[s]).join(" · ")}
        </Text>
      </View>

      {/* Books */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      >
        <Books />
      </ScrollView>
    </View>
  );
}
