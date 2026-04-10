#import "NativeOrderbookEngine.h"
#include "OrderbookEngine.h"
#include <memory>
#include <string>
#include <unordered_map>

// ─────────────────────────────────────────────────────────────────────────────
// NativeOrderbookEngine
//
// This is the React Native TurboModule. It sits between JavaScript and C++.
//
// Responsibilities:
//   1. Open ONE native WebSocket to Bitfinex
//   2. Subscribe to multiple symbols (BTC, ETH, XRP) on that single connection
//   3. Route incoming messages to the right C++ engine by channel ID
//   4. Let JS poll for the latest data via JSI (synchronous, no bridge overhead)
// ─────────────────────────────────────────────────────────────────────────────

@implementation NativeOrderbookEngine {
  // One C++ orderbook engine per symbol
  std::unordered_map<std::string, std::shared_ptr<turbobook::OrderbookEngine>> _engines;

  // Tracks how many updates each symbol has received (used for dirty-flag polling)
  std::unordered_map<std::string, int64_t> _updateCounts;

  // Bitfinex sends a channel ID (chanId) when you subscribe.
  // We use this to know which symbol an incoming message belongs to.
  std::unordered_map<int64_t, std::string> _chanIdToSymbol;

  // Tracks whether each symbol has an active subscription
  std::unordered_map<std::string, bool> _connected;

  // Native WebSocket (Apple's API, runs on a background thread automatically)
  NSURLSession              *_session;
  NSURLSessionWebSocketTask *_wsTask;

  // Connection settings (set by connectMulti, used again on reconnect)
  NSArray<NSString *> *_symbols;
  NSString *_prec, *_freq, *_len;

  // Reconnect state
  BOOL      _disconnecting;
  NSInteger _reconnectDelay;  // seconds, doubles on each failure up to 30s

  // Lock protecting shared state accessed from both the WS thread and JS thread
  NSLock *_lock;
}

RCT_EXPORT_MODULE(OrderbookEngine)

// ── Setup ──────────────────────────────────────────────────────────────────

- (instancetype)init {
  if (self = [super init]) {
    _lock           = [[NSLock alloc] init];
    _reconnectDelay = 2;
    _disconnecting  = NO;
    _session = [NSURLSession sessionWithConfiguration:
        NSURLSessionConfiguration.defaultSessionConfiguration];
  }
  return self;
}

// ── JS-callable methods ────────────────────────────────────────────────────

// Called by JS to start streaming. Opens one WebSocket for all symbols.
- (void)connectMulti:(NSArray<NSString *> *)symbols
                prec:(NSString *)prec
                freq:(NSString *)freq
                 len:(NSString *)len {
  [_lock lock];
  _symbols        = symbols;
  _prec           = prec;
  _freq           = freq;
  _len            = len;
  _disconnecting  = NO;
  _reconnectDelay = 2;

  // Create a fresh C++ engine for each symbol
  _engines.clear();
  _updateCounts.clear();
  _connected.clear();
  for (NSString *sym in symbols) {
    std::string s = sym.UTF8String;
    _engines[s]      = std::make_shared<turbobook::OrderbookEngine>();
    _updateCounts[s] = 0;
    _connected[s]    = false;
  }
  [_lock unlock];

  _chanIdToSymbol.clear();
  [self openSocket];
}

// Called by JS to stop streaming and clean up.
- (void)disconnect {
  [_lock lock];
  _disconnecting = YES;
  for (auto &kv : _connected) kv.second = false;
  [_lock unlock];

  [_wsTask cancel];
  _wsTask = nil;

  [_lock lock];
  _engines.clear();
  [_lock unlock];

  _chanIdToSymbol.clear();
}

// Returns the top N price levels for a symbol as a flat array.
// Format: [bidCount, askCount, price, count, amount, total, price, count, ...]
// Flat array is faster than nested objects across the JS bridge.
- (NSArray *)getTopLevels:(NSString *)symbol n:(double)n {
  std::string sym = symbol.UTF8String;

  // Copy the shared_ptr under lock, then call C++ outside the lock
  [_lock lock];
  auto it = _engines.find(sym);
  std::shared_ptr<turbobook::OrderbookEngine> engine;
  if (it != _engines.end()) engine = it->second;
  [_lock unlock];

  if (!engine) return @[];

  auto top = engine->getTopLevels((int)n);

  NSMutableArray *flat = [NSMutableArray array];
  [flat addObject:@(top.bids.size())];
  [flat addObject:@(top.asks.size())];
  for (const auto &l : top.bids) {
    [flat addObject:@(l.price)];
    [flat addObject:@(l.count)];
    [flat addObject:@(l.amount)];
    [flat addObject:@(l.total)];
  }
  for (const auto &l : top.asks) {
    [flat addObject:@(l.price)];
    [flat addObject:@(l.count)];
    [flat addObject:@(l.amount)];
    [flat addObject:@(l.total)];
  }
  return flat;
}

// Returns how many updates a symbol has received.
// JS uses this as a cheap "has anything changed?" check before calling getTopLevels.
- (NSDictionary *)getTimings:(NSString *)symbol {
  std::string sym = symbol.UTF8String;
  [_lock lock];
  int64_t count = _updateCounts.count(sym) ? _updateCounts[sym] : 0;
  [_lock unlock];
  return @{ @"totalUpdates": @(count) };
}

// Returns YES if this symbol has an active Bitfinex subscription.
- (NSNumber *)isConnected:(NSString *)symbol {
  std::string sym = symbol.UTF8String;
  [_lock lock];
  bool ok = _connected.count(sym) && _connected[sym];
  [_lock unlock];
  return @(ok);
}

// ── WebSocket ──────────────────────────────────────────────────────────────

- (void)openSocket {
  [_lock lock];
  BOOL shouldStop = _disconnecting;
  [_lock unlock];
  if (shouldStop) return;

  NSURL *url = [NSURL URLWithString:@"wss://api-pub.bitfinex.com/ws/2"];
  _wsTask = [_session webSocketTaskWithURL:url];
  [self receiveNextMessage];
  [_wsTask resume];
}

// Receives messages one at a time (Apple's API requires calling this again after each message)
- (void)receiveNextMessage {
  __weak NativeOrderbookEngine *weakSelf = self;
  [_wsTask receiveMessageWithCompletionHandler:^(NSURLSessionWebSocketMessage *msg, NSError *error) {
    NativeOrderbookEngine *self = weakSelf;
    if (!self) return;

    if (error) {
      NSLog(@"[TurboBook] WebSocket error: %@", error.localizedDescription);
      [self handleDisconnect];
      return;
    }

    NSString *text = (msg.type == NSURLSessionWebSocketMessageTypeString)
        ? msg.string
        : [[NSString alloc] initWithData:msg.data encoding:NSUTF8StringEncoding];

    if (text) [self handleMessage:text];
    [self receiveNextMessage];  // keep listening
  }];
}

// Send a subscribe request for every symbol
- (void)subscribeAll {
  for (NSString *symbol in _symbols) {
    NSDictionary *sub = @{
      @"event":   @"subscribe",
      @"channel": @"book",
      @"symbol":  symbol,
      @"prec":    _prec,
      @"freq":    _freq,
      @"len":     _len,
    };
    NSString *json = [[NSString alloc] initWithData:
        [NSJSONSerialization dataWithJSONObject:sub options:0 error:nil]
        encoding:NSUTF8StringEncoding];
    [_wsTask sendMessage:[[NSURLSessionWebSocketMessage alloc] initWithString:json]
       completionHandler:^(NSError *e) {}];
  }
}

// All incoming messages come here
- (void)handleMessage:(NSString *)text {
  id json = [NSJSONSerialization JSONObjectWithData:
      [text dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
  if (!json) return;

  // ── Event (dictionary) ─────────────────────────────────────────
  if ([json isKindOfClass:[NSDictionary class]]) {
    NSString *event = json[@"event"];

    if ([event isEqualToString:@"info"]) {
      // Bitfinex sends "info" first when the connection opens.
      // We subscribe here, not on socket open, because Bitfinex requires this order.
      NSLog(@"[TurboBook] Connected — subscribing to %lu symbols", (unsigned long)_symbols.count);
      [self subscribeAll];
    }

    if ([event isEqualToString:@"subscribed"] && [json[@"channel"] isEqualToString:@"book"]) {
      int64_t   chanId = [json[@"chanId"] longLongValue];
      NSString *sym    = json[@"symbol"];
      _chanIdToSymbol[chanId] = sym.UTF8String;

      [_lock lock];
      _connected[sym.UTF8String] = true;
      _reconnectDelay = 2;  // reset backoff — we got a successful subscription
      [_lock unlock];

      NSLog(@"[TurboBook] Subscribed to %@ (chanId %lld)", sym, chanId);
    }
    return;
  }

  // ── Data (array: [chanId, payload]) ───────────────────────────
  if (![json isKindOfClass:[NSArray class]]) return;
  NSArray *arr = json;
  if (arr.count < 2) return;

  int64_t chanId = [arr[0] longLongValue];
  auto it = _chanIdToSymbol.find(chanId);
  if (it == _chanIdToSymbol.end()) return;
  const std::string &sym = it->second;

  // Heartbeat — nothing to do
  if ([arr[1] isKindOfClass:[NSString class]] && [arr[1] isEqualToString:@"hb"]) return;

  // Get the engine for this symbol
  [_lock lock];
  auto engineIt = _engines.find(sym);
  std::shared_ptr<turbobook::OrderbookEngine> engine;
  if (engineIt != _engines.end()) engine = engineIt->second;
  [_lock unlock];
  if (!engine) return;

  NSArray *payload = arr[1];
  if (![payload isKindOfClass:[NSArray class]]) return;

  // ── Snapshot: array of arrays [[price, count, amount], ...] ───
  if ([payload[0] isKindOfClass:[NSArray class]]) {
    std::vector<std::tuple<double, int, double>> entries;
    for (NSArray *row in payload) {
      if (row.count < 3) continue;
      entries.emplace_back([row[0] doubleValue], [row[1] intValue], [row[2] doubleValue]);
    }
    engine->processSnapshot(entries);

    [_lock lock];
    _updateCounts[sym] += (int64_t)payload.count;
    [_lock unlock];
    return;
  }

  // ── Delta: flat array [price, count, amount] ───────────────────
  if (payload.count >= 3 && [payload[0] isKindOfClass:[NSNumber class]]) {
    engine->processDelta([payload[0] doubleValue], [payload[1] intValue], [payload[2] doubleValue]);

    [_lock lock];
    _updateCounts[sym]++;
    [_lock unlock];
  }
}

// ── Reconnect with exponential backoff ─────────────────────────────────────

- (void)handleDisconnect {
  [_lock lock];
  for (auto &kv : _connected) kv.second = false;
  BOOL shouldStop    = _disconnecting;
  NSInteger delay    = _reconnectDelay;
  _reconnectDelay    = MIN(_reconnectDelay * 2, 30);  // 2 → 4 → 8 → 16 → 30s cap
  [_lock unlock];

  [_wsTask cancel];
  _wsTask = nil;
  _chanIdToSymbol.clear();

  if (shouldStop) return;

  NSLog(@"[TurboBook] Disconnected — reconnecting in %lds", (long)delay);
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, delay * NSEC_PER_SEC),
      dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0),
      ^{ [self openSocket]; });
}

// ── TurboModule boilerplate ────────────────────────────────────────────────
// This wires the class into the React Native New Architecture codegen system.

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeOrderbookEngineSpecJSI>(params);
}

@end
