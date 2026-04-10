# TurboBook — Orderbook Performance Benchmarks

Comparing JS Bridge vs Turbo Module implementations for real-time orderbook processing.

---

## JS Bridge (Current)

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

### Run 1 — 30s (peak activity)

| Metric | Value |
|--------|-------|
| **Runtime** | Hermes (React Native 0.81) |
| **Uptime** | 30s |
| **Total WS Updates** | 1,218 |
| **Total Renders** | 90 |

| Metric | Value |
|--------|-------|
| Updates/sec (WS) | **87** |
| Renders/sec (UI) | **5** |
| Update:Render ratio | **17.4:1** |

| Stage | Avg | Peak |
|-------|-----|------|
| JSON.parse | 0.97 μs | 10.04 μs |
| Process (sort+build) | 92.5 μs | 543.29 μs |
| setState flush | 113.88 μs | 346.96 μs |
| **Total per render** | **207.3 μs** | **900.3 μs** |

| Snapshot | Value |
|----------|-------|
| Parse | 33.17 μs |
| Process | 51.75 μs |

### Run 2 — 34s (moderate activity)

| Metric | Value |
|--------|-------|
| **Uptime** | 34s |
| **Total WS Updates** | 1,378 |
| **Total Renders** | 104 |

| Metric | Value |
|--------|-------|
| Updates/sec (WS) | **16** |
| Renders/sec (UI) | **2** |
| Update:Render ratio | **8.0:1** |

| Stage | Avg | Peak |
|-------|-----|------|
| JSON.parse | 1.08 μs | 10.04 μs |
| Process (sort+build) | 95.69 μs | 543.29 μs |
| setState flush | 121.59 μs | 421.42 μs |
| **Total per render** | **218.4 μs** | **974.8 μs** |

### Run 3 — 60s (sustained)

| Metric | Value |
|--------|-------|
| **Uptime** | 60s |
| **Total WS Updates** | 2,696 |
| **Total Renders** | 200 |

| Stage | Avg | Peak |
|-------|-----|------|
| JSON.parse | 1.35 μs | 12.58 μs |
| Process (sort+build) | 102.74 μs | 543.29 μs |
| setState flush | 160.25 μs | **1,263.71 μs** |
| **Total per render** | **264.3 μs** | **1,819.6 μs** |

---

### Analysis — JS Bridge

**Strengths:**
- JSON parsing is extremely fast (~1μs avg) — Hermes handles this well
- Snapshot processing is cheap (51μs for 25 entries)
- Batching works well at 17:1 ratio during peak, keeping renders low

**Bottlenecks:**
- `setState` flush is the slowest stage and degrades over time (113→160μs avg, 347→1,264μs peak)
- Process time creeps up slightly (92→103μs) as Map grows
- Peak flush hit **1.26ms** at 60s — this is the JS→Native bridge overhead showing up
- At 87 updates/sec peak, only 5 renders/sec make it through — 94% of updates are batched away

**Key takeaway:** The bridge crossing (`setState`) is the dominant cost, not the JS computation itself. A Turbo Module that processes on the native side and uses synchronous JSI calls could eliminate this bottleneck entirely.

---

## Turbo Module (Future)

> To be added after implementing native orderbook processing via C++ Turbo Module.
> Expected improvements:
> - Eliminate JSON.parse (binary protocol or native parsing)
> - Eliminate setState bridge crossing (JSI synchronous calls)
> - Native-side sort + cumulative total computation
> - Target: <50μs total per render, consistent under load

---
