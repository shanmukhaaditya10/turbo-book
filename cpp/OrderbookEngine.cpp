#include "OrderbookEngine.h"

#include <cmath>

namespace turbobook {

// ── Snapshot ───────────────────────────────────────────────────────
// Called once when we first subscribe. Replaces the entire book.

void OrderbookEngine::processSnapshot(
    const std::vector<std::tuple<double, int, double>>& entries) {
  std::lock_guard<std::mutex> lock(mu_);
  bids_.clear();
  asks_.clear();

  for (const auto& [price, count, amount] : entries) {
    if (count == 0) continue;

    // Bitfinex: positive amount = bid, negative amount = ask
    if (amount > 0) {
      bids_[price] = {price, count, amount};
    } else {
      asks_[price] = {price, count, std::fabs(amount)};
    }
  }
}

// ── Delta ──────────────────────────────────────────────────────────
// Called for every live update. Either adds/updates or removes a level.

void OrderbookEngine::processDelta(double price, int count, double amount) {
  std::lock_guard<std::mutex> lock(mu_);

  if (count == 0) {
    // count == 0 means "remove this price level"
    // Bitfinex signals the side via amount: +1 = bid, -1 = ask
    if (amount > 0) {
      bids_.erase(price);
    } else {
      asks_.erase(price);
    }
  } else {
    // Add or update the level
    if (amount > 0) {
      bids_[price] = {price, count, amount};
    } else {
      asks_[price] = {price, count, std::fabs(amount)};
    }
  }
}

// ── getTopLevels ───────────────────────────────────────────────────
// Returns the top N bids and asks. Because std::map is already sorted,
// we just walk from the beginning and stop after N entries.

TopLevels OrderbookEngine::getTopLevels(int n) const {
  std::lock_guard<std::mutex> lock(mu_);

  TopLevels result;
  double cumulative = 0;
  int i = 0;

  for (const auto& [price, level] : bids_) {
    if (i >= n) break;
    cumulative += level.amount;
    result.bids.push_back({level.price, level.count, level.amount, cumulative});
    i++;
  }

  cumulative = 0;
  i = 0;
  for (const auto& [price, level] : asks_) {
    if (i >= n) break;
    cumulative += level.amount;
    result.asks.push_back({level.price, level.count, level.amount, cumulative});
    i++;
  }

  return result;
}

}  // namespace turbobook
