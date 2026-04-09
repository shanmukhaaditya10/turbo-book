import { View, Text, ScrollView, Pressable, Alert } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useMemo } from "react";
import {
  useOrderbook,
  formatPrice,
  formatAmount,
  formatTotal,
  getPerfTracker,
  type OrderbookEntry,
} from "../lib/orderbook";

const DEPTH = 20;

function DepthRow({
  entry,
  maxTotal,
  side,
}: {
  entry: OrderbookEntry;
  maxTotal: number;
  side: "bid" | "ask";
}) {
  const pct = maxTotal > 0 ? (entry.total / maxTotal) * 100 : 0;
  const barColor =
    side === "bid" ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)";
  const priceColor = side === "bid" ? "#4ade80" : "#f87171";

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        height: 32,
        paddingHorizontal: 12,
      }}
    >
      <View
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: `${pct}%` as any,
          backgroundColor: barColor,
        }}
      />
      <Text
        style={{
          color: priceColor,
          fontSize: 14,
          fontVariant: ["tabular-nums"],
          flex: 1,
          fontWeight: "600",
        }}
      >
        {formatPrice(entry.price)}
      </Text>
      <Text
        style={{
          color: "#e5e7eb",
          fontSize: 13,
          fontVariant: ["tabular-nums"],
          flex: 1,
          textAlign: "right",
        }}
      >
        {formatAmount(entry.amount)}
      </Text>
      <Text
        style={{
          color: "#9ca3af",
          fontSize: 13,
          fontVariant: ["tabular-nums"],
          flex: 1,
          textAlign: "right",
        }}
      >
        {formatTotal(entry.total)}
      </Text>
      <Text
        style={{
          color: "#6b7280",
          fontSize: 12,
          fontVariant: ["tabular-nums"],
          width: 36,
          textAlign: "right",
        }}
      >
        {entry.count}
      </Text>
    </View>
  );
}

export default function Index() {
  const book = useOrderbook("tBTCUSD", "P0", DEPTH);
  const { perf } = book;

  const maxBidTotal = book.bids[book.bids.length - 1]?.total ?? 0;
  const maxAskTotal = book.asks[book.asks.length - 1]?.total ?? 0;
  const reversedAsks = useMemo(() => [...book.asks].reverse(), [book.asks]);

  const bestBid = book.bids[0]?.price ?? 0;
  const bestAsk = book.asks[0]?.price ?? 0;
  const midPrice = (bestBid + bestAsk) / 2;

  const dumpReport = () => {
    const tracker = getPerfTracker();
    if (tracker) {
      const report = tracker.generateReport();
      console.log("\n=== BENCHMARK REPORT ===\n" + report);
      Alert.alert("Benchmark Logged", "Report printed to console. Copy from Metro terminal.");
    }
  };

  return (
    <View className="flex-1 bg-gray-950 pt-14">
      <StatusBar style="light" />

      {/* Header */}
      <View className="px-4 pb-2">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-white text-2xl font-bold">BTC/USD</Text>
            <Text className="text-gray-400 text-sm mt-0.5">
              Bitfinex Orderbook
            </Text>
          </View>
          <View className="items-end">
            <Text className="text-white text-xl font-semibold">
              {midPrice > 0 ? formatPrice(midPrice) : "---"}
            </Text>
            <View className="flex-row items-center mt-1">
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: book.connected ? "#22c55e" : "#ef4444",
                  marginRight: 6,
                }}
              />
              <Text
                style={{
                  color: book.connected ? "#22c55e" : "#ef4444",
                  fontSize: 12,
                  fontWeight: "700",
                }}
              >
                {book.connected ? "LIVE WS" : "CONNECTING..."}
              </Text>
            </View>
          </View>
        </View>

        {/* Stats row 1 */}
        <View className="flex-row mt-3" style={{ gap: 8 }}>
          <View className="flex-1 bg-gray-900/80 rounded-xl px-3 py-2">
            <Text style={{ color: "#9ca3af", fontSize: 10 }}>SPREAD</Text>
            <Text
              style={{ color: "#facc15", fontSize: 14, fontWeight: "700", fontVariant: ["tabular-nums"], marginTop: 2 }}
            >
              {book.spread > 0 ? `$${formatPrice(book.spread)}` : "---"}
            </Text>
          </View>
          <View className="flex-1 bg-gray-900/80 rounded-xl px-3 py-2">
            <Text style={{ color: "#9ca3af", fontSize: 10 }}>UPD/SEC</Text>
            <Text
              style={{ color: "#22d3ee", fontSize: 14, fontWeight: "700", fontVariant: ["tabular-nums"], marginTop: 2 }}
            >
              {perf.updatesPerSec}
            </Text>
          </View>
          <View className="flex-1 bg-gray-900/80 rounded-xl px-3 py-2">
            <Text style={{ color: "#9ca3af", fontSize: 10 }}>RENDERS/S</Text>
            <Text
              style={{ color: "#a78bfa", fontSize: 14, fontWeight: "700", fontVariant: ["tabular-nums"], marginTop: 2 }}
            >
              {perf.rendersPerSec}
            </Text>
          </View>
        </View>

        {/* Stats row 2 — perf timings */}
        <View className="flex-row mt-2" style={{ gap: 8 }}>
          <View className="flex-1 bg-gray-900/80 rounded-xl px-3 py-2">
            <Text style={{ color: "#9ca3af", fontSize: 10 }}>PARSE</Text>
            <Text
              style={{ color: "#fb923c", fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"], marginTop: 2 }}
            >
              {perf.avgParseTimeUs.toFixed(0)}μs
            </Text>
            <Text style={{ color: "#6b7280", fontSize: 9, marginTop: 1 }}>
              peak {perf.maxParseTimeUs.toFixed(0)}μs
            </Text>
          </View>
          <View className="flex-1 bg-gray-900/80 rounded-xl px-3 py-2">
            <Text style={{ color: "#9ca3af", fontSize: 10 }}>PROCESS</Text>
            <Text
              style={{ color: "#fb923c", fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"], marginTop: 2 }}
            >
              {perf.avgProcessTimeUs.toFixed(0)}μs
            </Text>
            <Text style={{ color: "#6b7280", fontSize: 9, marginTop: 1 }}>
              peak {perf.maxProcessTimeUs.toFixed(0)}μs
            </Text>
          </View>
          <View className="flex-1 bg-gray-900/80 rounded-xl px-3 py-2">
            <Text style={{ color: "#9ca3af", fontSize: 10 }}>FLUSH</Text>
            <Text
              style={{ color: "#fb923c", fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"], marginTop: 2 }}
            >
              {perf.avgFlushTimeUs.toFixed(0)}μs
            </Text>
            <Text style={{ color: "#6b7280", fontSize: 9, marginTop: 1 }}>
              peak {perf.maxFlushTimeUs.toFixed(0)}μs
            </Text>
          </View>
        </View>

        {/* Benchmark button */}
        <Pressable
          onPress={dumpReport}
          style={{
            marginTop: 8,
            backgroundColor: "#1e293b",
            borderRadius: 8,
            paddingVertical: 8,
            alignItems: "center",
            borderWidth: 1,
            borderColor: "#334155",
          }}
        >
          <Text style={{ color: "#94a3b8", fontSize: 12, fontWeight: "600" }}>
            DUMP BENCHMARK TO CONSOLE
          </Text>
        </Pressable>
      </View>

      {/* Column headers */}
      <View
        style={{
          flexDirection: "row",
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderBottomColor: "#374151",
        }}
      >
        <Text style={{ color: "#9ca3af", fontSize: 11, flex: 1, fontWeight: "600" }}>
          PRICE
        </Text>
        <Text style={{ color: "#9ca3af", fontSize: 11, flex: 1, textAlign: "right", fontWeight: "600" }}>
          SIZE (BTC)
        </Text>
        <Text style={{ color: "#9ca3af", fontSize: 11, flex: 1, textAlign: "right", fontWeight: "600" }}>
          TOTAL
        </Text>
        <Text style={{ color: "#9ca3af", fontSize: 11, width: 36, textAlign: "right", fontWeight: "600" }}>
          CNT
        </Text>
      </View>

      {/* Orderbook */}
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {reversedAsks.map((entry) => (
          <DepthRow key={`a-${entry.price}`} entry={entry} maxTotal={maxAskTotal} side="ask" />
        ))}

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingVertical: 10,
            borderTopWidth: 1,
            borderBottomWidth: 1,
            borderColor: "#374151",
          }}
        >
          <Text style={{ color: "#facc15", fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] }}>
            SPREAD ${book.spread > 0 ? formatPrice(book.spread) : "---"}
          </Text>
        </View>

        {book.bids.map((entry) => (
          <DepthRow key={`b-${entry.price}`} entry={entry} maxTotal={maxBidTotal} side="bid" />
        ))}
      </ScrollView>
    </View>
  );
}
