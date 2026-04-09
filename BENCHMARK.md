# TurboBook — Orderbook Performance Benchmarks

Comparing JS Bridge vs Turbo Module implementations for real-time orderbook processing.

---

## JS Bridge (Current)

Paste benchmark reports from the console below. Each report is auto-generated every 30s
and can also be triggered via the "DUMP BENCHMARK" button in the app.

### What's being measured

| Stage | What it does |
|-------|-------------|
| **Parse** | `JSON.parse()` of raw WebSocket message string |
| **Process** | `Map.set()` update + `Array.sort()` + cumulative total calculation for 20-depth book |
| **Flush** | `setState()` call to trigger React re-render |

### Metrics explained

- **Updates/sec** — WebSocket messages received per second (raw throughput)
- **Renders/sec** — React re-renders per second (throttled to ~20fps via 50ms setTimeout)
- **Update:Render ratio** — How many WS updates are batched per render (higher = more efficient batching)
- **Avg/Peak timings** — Processing latency in microseconds (μs). Lower is better.

---

### Run 1 — JS Bridge Baseline

> Paste the console output here after running for 30+ seconds

```
(pending — press DUMP BENCHMARK in app or wait 30s for auto-log)
```

---

## Turbo Module (Future)

> To be added after implementing native orderbook processing via C++ Turbo Module

---
