#include "OrderbookEngine.h"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <sstream>
#include <string>

namespace turbobook {

// ── CRC32 (Bitfinex format) ────────────────────────────────────

static uint32_t crc32Table[256];
static bool crc32Init = false;

static void initCrc32Table() {
  for (uint32_t i = 0; i < 256; i++) {
    uint32_t c = i;
    for (int j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
    }
    crc32Table[i] = c;
  }
  crc32Init = true;
}

static uint32_t crc32(const std::string& data) {
  if (!crc32Init) initCrc32Table();
  uint32_t c = 0xFFFFFFFF;
  for (unsigned char ch : data) {
    c = crc32Table[(c ^ ch) & 0xFF] ^ (c >> 8);
  }
  return c ^ 0xFFFFFFFF;
}

// Format a double without trailing zeros, matching Bitfinex checksum format
static std::string formatDouble(double v) {
  char buf[64];
  std::snprintf(buf, sizeof(buf), "%.8f", v);
  std::string s(buf);
  // Strip trailing zeros after decimal point
  auto dot = s.find('.');
  if (dot != std::string::npos) {
    auto last = s.find_last_not_of('0');
    if (last == dot) {
      s.erase(dot);
    } else {
      s.erase(last + 1);
    }
  }
  return s;
}

// ── Engine ──────────────────────────────────────────────────────

void OrderbookEngine::processSnapshot(
    const std::vector<std::tuple<double, int, double>>& entries) {
  std::lock_guard<std::mutex> lock(mu_);
  bids_.clear();
  asks_.clear();
  for (const auto& [price, count, amount] : entries) {
    if (count == 0) continue;
    double absAmt = std::fabs(amount);
    if (amount > 0) {
      bids_[price] = {price, count, absAmt};
    } else {
      asks_[price] = {price, count, absAmt};
    }
  }
}

void OrderbookEngine::processDelta(double price, int count, double amount) {
  std::lock_guard<std::mutex> lock(mu_);
  if (count == 0) {
    // Delete: amount=1 means bid side, amount=-1 means ask side
    if (amount == 1.0) {
      bids_.erase(price);
    } else if (amount == -1.0) {
      asks_.erase(price);
    }
  } else {
    double absAmt = std::fabs(amount);
    if (amount > 0) {
      bids_[price] = {price, count, absAmt};
    } else {
      asks_[price] = {price, count, absAmt};
    }
  }
}

void OrderbookEngine::reset() {
  std::lock_guard<std::mutex> lock(mu_);
  bids_.clear();
  asks_.clear();
}

template <typename MapType>
static std::vector<LevelWithTotal> extractTopImpl(
    const MapType& book, int n) {
  std::vector<LevelWithTotal> result;
  result.reserve(n);
  double cumTotal = 0;
  int i = 0;
  for (const auto& [_, level] : book) {
    if (i >= n) break;
    cumTotal += level.amount;
    result.push_back({level.price, level.count, level.amount, cumTotal});
    i++;
  }
  return result;
}

TopLevels OrderbookEngine::getTopLevels(int n) const {
  std::lock_guard<std::mutex> lock(mu_);
  auto t0 = std::chrono::steady_clock::now();
  auto bids = extractTopImpl(bids_, n);
  auto asks = extractTopImpl(asks_, n);
  auto t1 = std::chrono::steady_clock::now();
  int64_t traversalUs =
      std::chrono::duration_cast<std::chrono::microseconds>(t1 - t0).count();
  return {std::move(bids), std::move(asks), traversalUs};
}

uint32_t OrderbookEngine::getChecksum() const {
  std::lock_guard<std::mutex> lock(mu_);
  // Bitfinex checksum: interleave top 25 bids and asks
  // Format: "BID_PRICE:BID_AMOUNT:ASK_PRICE:ASK_AMOUNT:..."
  std::string checksumStr;
  auto bidIt = bids_.begin();
  auto askIt = asks_.begin();

  for (int i = 0; i < 25; i++) {
    if (bidIt != bids_.end()) {
      if (!checksumStr.empty()) checksumStr += ':';
      checksumStr += formatDouble(bidIt->second.price);
      checksumStr += ':';
      checksumStr += formatDouble(bidIt->second.amount);
      ++bidIt;
    }
    if (askIt != asks_.end()) {
      if (!checksumStr.empty()) checksumStr += ':';
      checksumStr += formatDouble(askIt->second.price);
      checksumStr += ':';
      // Asks are negative in checksum
      checksumStr += formatDouble(-askIt->second.amount);
      ++askIt;
    }
  }

  return crc32(checksumStr);
}

}  // namespace turbobook
