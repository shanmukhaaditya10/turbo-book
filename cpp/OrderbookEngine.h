#pragma once

#include <cstdint>
#include <map>
#include <mutex>
#include <vector>

namespace turbobook {

struct Level {
  double price;
  int count;
  double amount;
};

struct LevelWithTotal {
  double price;
  int count;
  double amount;
  double total;
};

struct TopLevels {
  std::vector<LevelWithTotal> bids;
  std::vector<LevelWithTotal> asks;
};

class OrderbookEngine {
 public:
  void processSnapshot(const std::vector<std::tuple<double, int, double>>& entries);
  void processDelta(double price, int count, double amount);
  void reset();
  TopLevels getTopLevels(int n) const;
  uint32_t getChecksum() const;

 private:
  mutable std::mutex mu_;
  // bids: descending by price (std::greater)
  std::map<double, Level, std::greater<double>> bids_;
  // asks: ascending by price (default)
  std::map<double, Level> asks_;
};

}  // namespace turbobook
