#include "OrderbookEngineModule.h"

#include <vector>
#include <tuple>

namespace facebook::react {

// ── Host functions ──────────────────────────────────────────────

static jsi::Value __hostFn_processSnapshot(
    jsi::Runtime& rt,
    TurboModule& turboModule,
    const jsi::Value* args,
    size_t count) {
  auto& self = static_cast<OrderbookEngineModule&>(turboModule);
  // args[0] is a flat array: [price, count, amount, price, count, amount, ...]
  auto arr = args[0].asObject(rt).asArray(rt);
  size_t len = arr.size(rt);
  std::vector<std::tuple<double, int, double>> entries;
  entries.reserve(len / 3);
  for (size_t i = 0; i + 2 < len; i += 3) {
    double price = arr.getValueAtIndex(rt, i).asNumber();
    int cnt = static_cast<int>(arr.getValueAtIndex(rt, i + 1).asNumber());
    double amount = arr.getValueAtIndex(rt, i + 2).asNumber();
    entries.emplace_back(price, cnt, amount);
  }
  self.engine_.processSnapshot(entries);
  return jsi::Value::undefined();
}

static jsi::Value __hostFn_processDelta(
    jsi::Runtime& rt,
    TurboModule& turboModule,
    const jsi::Value* args,
    size_t count) {
  auto& self = static_cast<OrderbookEngineModule&>(turboModule);
  double price = args[0].asNumber();
  int cnt = static_cast<int>(args[1].asNumber());
  double amount = args[2].asNumber();
  self.engine_.processDelta(price, cnt, amount);
  return jsi::Value::undefined();
}

static jsi::Value __hostFn_reset(
    jsi::Runtime& rt,
    TurboModule& turboModule,
    const jsi::Value* args,
    size_t count) {
  auto& self = static_cast<OrderbookEngineModule&>(turboModule);
  self.engine_.reset();
  return jsi::Value::undefined();
}

static jsi::Value __hostFn_getTopLevels(
    jsi::Runtime& rt,
    TurboModule& turboModule,
    const jsi::Value* args,
    size_t count) {
  auto& self = static_cast<OrderbookEngineModule&>(turboModule);
  int n = static_cast<int>(args[0].asNumber());
  auto top = self.engine_.getTopLevels(n);

  // Build bids array: [[price, count, amount, total], ...]
  auto buildArray = [&](const std::vector<turbobook::LevelWithTotal>& levels) {
    jsi::Array arr(rt, levels.size());
    for (size_t i = 0; i < levels.size(); i++) {
      jsi::Array row(rt, 4);
      row.setValueAtIndex(rt, 0, levels[i].price);
      row.setValueAtIndex(rt, 1, static_cast<double>(levels[i].count));
      row.setValueAtIndex(rt, 2, levels[i].amount);
      row.setValueAtIndex(rt, 3, levels[i].total);
      arr.setValueAtIndex(rt, i, std::move(row));
    }
    return arr;
  };

  jsi::Object result(rt);
  result.setProperty(rt, "bids", buildArray(top.bids));
  result.setProperty(rt, "asks", buildArray(top.asks));
  return result;
}

static jsi::Value __hostFn_getChecksum(
    jsi::Runtime& rt,
    TurboModule& turboModule,
    const jsi::Value* args,
    size_t count) {
  auto& self = static_cast<OrderbookEngineModule&>(turboModule);
  return jsi::Value(static_cast<double>(self.engine_.getChecksum()));
}

// ── Constructor ─────────────────────────────────────────────────

OrderbookEngineModule::OrderbookEngineModule(
    std::shared_ptr<CallInvoker> jsInvoker)
    : TurboModule("OrderbookEngine", std::move(jsInvoker)) {
  methodMap_["processSnapshot"] = MethodMetadata{1, __hostFn_processSnapshot};
  methodMap_["processDelta"] = MethodMetadata{3, __hostFn_processDelta};
  methodMap_["reset"] = MethodMetadata{0, __hostFn_reset};
  methodMap_["getTopLevels"] = MethodMetadata{1, __hostFn_getTopLevels};
  methodMap_["getChecksum"] = MethodMetadata{0, __hostFn_getChecksum};
}

}  // namespace facebook::react
