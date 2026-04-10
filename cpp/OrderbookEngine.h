#pragma once

#include <map>
#include <mutex>
#include <vector>

namespace turbobook {

// One price level in the orderbook
struct Level {
  double price;
  int    count;   // number of orders at this price
  double amount;  // total size at this price
};

// Level with a running cumulative total (for depth bar visualisation)
struct LevelWithTotal {
  double price;
  int    count;
  double amount;
  double total;  // sum of all amounts from best price up to this level
};

// What getTopLevels() returns
struct TopLevels {
  std::vector<LevelWithTotal> bids;
  std::vector<LevelWithTotal> asks;
};

class OrderbookEngine {
 public:
  // Replace the whole book with a fresh snapshot from the exchange
  void processSnapshot(const std::vector<std::tuple<double, int, double>>& entries);

  // Apply a single delta update (add, update, or remove one price level)
  void processDelta(double price, int count, double amount);

  // Return the top N bids and asks with cumulative totals
  TopLevels getTopLevels(int n) const;

 private:
  mutable std::mutex mu_;

  // std::map keeps keys sorted automatically.
  // Bids: highest price first (std::greater), Asks: lowest price first (default)
  std::map<double, Level, std::greater<double>> bids_;
  std::map<double, Level>                       asks_;
};

}  // namespace turbobook
