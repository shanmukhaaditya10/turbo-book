#import "NativeOrderbookEngine.h"
#include "OrderbookEngine.h"
#include <chrono>
#include <memory>
#include <string>
#include <unordered_map>

// ── Per-symbol stats ──────────────────────────────────────────────

struct SymbolStats {
  int64_t lastMapTraversalUs = 0;
  int64_t lastArrayBuildUs   = 0;
  int64_t totalUpdates       = 0;
  bool    subscribed         = false;
};

@implementation NativeOrderbookEngine {
  // One C++ engine per symbol (shared_ptr so we can safely release the lock
  // before calling into C++, which has its own internal mutex)
  std::unordered_map<std::string, std::shared_ptr<turbobook::OrderbookEngine>> _engines;
  std::unordered_map<std::string, SymbolStats> _stats;

  // WS receive thread only — no lock needed (sequential callbacks)
  std::unordered_map<int64_t, std::string> _chanIdToSymbol;

  // WebSocket
  NSURLSession              *_session;
  NSURLSessionWebSocketTask *_wsTask;

  // Connection parameters (set by connectMulti:, immutable until next call)
  NSArray<NSString *> *_symbols;
  NSString *_prec, *_freq, *_len;

  BOOL      _disconnecting;
  NSInteger _reconnectDelay;

  // Protects: _engines, _stats, _disconnecting, _reconnectDelay
  NSLock *_stateLock;
}

RCT_EXPORT_MODULE(OrderbookEngine)

// ── Init ──────────────────────────────────────────────────────────

- (instancetype)init {
  if (self = [super init]) {
    _stateLock      = [[NSLock alloc] init];
    _reconnectDelay = 2;
    _disconnecting  = NO;

    NSURLSessionConfiguration *cfg =
        [NSURLSessionConfiguration defaultSessionConfiguration];
    cfg.requestCachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
    _session = [NSURLSession sessionWithConfiguration:cfg];
  }
  return self;
}

// ── connectMulti ──────────────────────────────────────────────────

- (void)connectMulti:(NSArray<NSString *> *)symbols
                prec:(NSString *)prec
                freq:(NSString *)freq
                 len:(NSString *)len {
  [_stateLock lock];
  _symbols        = symbols;
  _prec           = prec;
  _freq           = freq;
  _len            = len;
  _disconnecting  = NO;
  _reconnectDelay = 2;

  _engines.clear();
  _stats.clear();
  for (NSString *sym in symbols) {
    std::string s = sym.UTF8String;
    _engines[s] = std::make_shared<turbobook::OrderbookEngine>();
    _stats[s]   = SymbolStats{};
  }
  [_stateLock unlock];

  // WS receive thread: reset channel map
  _chanIdToSymbol.clear();

  [self _openSocket];
}

// ── disconnect ────────────────────────────────────────────────────

- (void)disconnect {
  [_stateLock lock];
  _disconnecting = YES;
  for (auto &kv : _stats) kv.second.subscribed = false;
  [_stateLock unlock];

  [_wsTask cancel];
  _wsTask = nil;

  [_stateLock lock];
  _engines.clear();
  [_stateLock unlock];

  _chanIdToSymbol.clear();
}

// ── getTopLevels ──────────────────────────────────────────────────

- (NSArray *)getTopLevels:(NSString *)symbol n:(double)n {
  std::string sym = symbol.UTF8String;

  [_stateLock lock];
  auto it = _engines.find(sym);
  std::shared_ptr<turbobook::OrderbookEngine> engine;
  if (it != _engines.end()) engine = it->second;
  [_stateLock unlock];

  if (!engine) return @[];

  // C++ map traversal — timed inside OrderbookEngine::getTopLevels
  auto top = engine->getTopLevels(static_cast<int>(n));

  // Build flat array: [bidCount, askCount, p,c,a,t per level...]
  auto t0 = std::chrono::steady_clock::now();

  NSUInteger capacity = 2 + (top.bids.size() + top.asks.size()) * 4;
  NSMutableArray *flat = [NSMutableArray arrayWithCapacity:capacity];
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

  auto t1 = std::chrono::steady_clock::now();
  int64_t arrayBuildUs =
      std::chrono::duration_cast<std::chrono::microseconds>(t1 - t0).count();

  [_stateLock lock];
  auto &stats            = _stats[sym];
  stats.lastMapTraversalUs = top.traversalUs;
  stats.lastArrayBuildUs   = arrayBuildUs;
  [_stateLock unlock];

  return flat;
}

// ── getTimings ────────────────────────────────────────────────────

- (NSDictionary *)getTimings:(NSString *)symbol {
  std::string sym = symbol.UTF8String;
  [_stateLock lock];
  auto it = _stats.find(sym);
  SymbolStats s = (it != _stats.end()) ? it->second : SymbolStats{};
  [_stateLock unlock];
  return @{
    @"mapTraversalUs": @(s.lastMapTraversalUs),
    @"arrayBuildUs":   @(s.lastArrayBuildUs),
    @"totalUpdates":   @(s.totalUpdates),
  };
}

// ── isConnected ───────────────────────────────────────────────────

- (NSNumber *)isConnected:(NSString *)symbol {
  std::string sym = symbol.UTF8String;
  [_stateLock lock];
  auto it = _stats.find(sym);
  bool connected = (it != _stats.end()) && it->second.subscribed;
  [_stateLock unlock];
  return @(connected);
}

// ── WebSocket internals ───────────────────────────────────────────

- (void)_openSocket {
  [_stateLock lock];
  BOOL shouldStop = _disconnecting;
  [_stateLock unlock];
  if (shouldStop) return;

  NSURL *url = [NSURL URLWithString:@"wss://api-pub.bitfinex.com/ws/2"];
  _wsTask = [_session webSocketTaskWithRequest:[NSURLRequest requestWithURL:url]];
  [self _receiveNext];
  [_wsTask resume];
  NSLog(@"[ws-native] connecting for %lu symbols...", (unsigned long)_symbols.count);
}

- (void)_receiveNext {
  __weak NativeOrderbookEngine *weakSelf = self;
  [_wsTask receiveMessageWithCompletionHandler:^(
      NSURLSessionWebSocketMessage *msg, NSError *error) {
    NativeOrderbookEngine *s = weakSelf;
    if (!s) return;

    if (error) {
      NSLog(@"[ws-native] error: %@", error.localizedDescription);
      [s _handleDisconnect];
      return;
    }

    NSString *text = nil;
    if (msg.type == NSURLSessionWebSocketMessageTypeString) {
      text = msg.string;
    } else if (msg.type == NSURLSessionWebSocketMessageTypeData) {
      text = [[NSString alloc] initWithData:msg.data encoding:NSUTF8StringEncoding];
    }
    if (text) [s _handleMessage:text];

    [s _receiveNext];
  }];
}

- (void)_sendSubscribeAll {
  for (NSString *symbol in _symbols) {
    NSDictionary *sub = @{
      @"event":   @"subscribe",
      @"channel": @"book",
      @"symbol":  symbol,
      @"prec":    _prec,
      @"freq":    _freq,
      @"len":     _len,
    };
    NSData   *data = [NSJSONSerialization dataWithJSONObject:sub options:0 error:nil];
    NSString *str  = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    [_wsTask sendMessage:[[NSURLSessionWebSocketMessage alloc] initWithString:str]
       completionHandler:^(NSError *e) {
      if (e) NSLog(@"[ws-native] subscribe error for %@: %@", symbol, e.localizedDescription);
    }];
  }
}

- (void)_handleMessage:(NSString *)text {
  NSData *data = [text dataUsingEncoding:NSUTF8StringEncoding];
  id json = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (!json) return;

  // ── Event object ──────────────────────────────────────────────
  if ([json isKindOfClass:[NSDictionary class]]) {
    NSDictionary *dict  = json;
    NSString     *event = dict[@"event"];

    if ([event isEqualToString:@"info"]) {
      // Bitfinex sends info first — subscribe all symbols now
      NSLog(@"[ws-native] connected, subscribing %lu symbols...",
            (unsigned long)_symbols.count);
      [self _sendSubscribeAll];
      return;
    }

    if ([event isEqualToString:@"subscribed"] &&
        [dict[@"channel"] isEqualToString:@"book"]) {
      int64_t   chanId = [dict[@"chanId"] longLongValue];
      NSString *symNS  = dict[@"symbol"];
      std::string sym  = symNS.UTF8String;

      _chanIdToSymbol[chanId] = sym;

      [_stateLock lock];
      _stats[sym].subscribed  = true;
      _reconnectDelay         = 2;  // reset backoff on any successful sub
      [_stateLock unlock];

      NSLog(@"[ws-native] subscribed %@ chanId=%lld", symNS, chanId);
    }
    return;
  }

  // ── Array message: [chanId, payload] ──────────────────────────
  if (![json isKindOfClass:[NSArray class]]) return;
  NSArray *arr = json;
  if (arr.count < 2) return;

  int64_t chanId = [arr[0] longLongValue];
  auto chanIt = _chanIdToSymbol.find(chanId);
  if (chanIt == _chanIdToSymbol.end()) return;
  const std::string &sym = chanIt->second;

  [_stateLock lock];
  auto engineIt = _engines.find(sym);
  std::shared_ptr<turbobook::OrderbookEngine> engine;
  if (engineIt != _engines.end()) engine = engineIt->second;
  [_stateLock unlock];

  if (!engine) return;

  id payload = arr[1];
  if ([payload isKindOfClass:[NSString class]] &&
      [(NSString *)payload isEqualToString:@"hb"]) return;

  // ── Snapshot ──────────────────────────────────────────────────
  if ([payload isKindOfClass:[NSArray class]] &&
      [(NSArray *)payload count] > 0 &&
      [((NSArray *)payload)[0] isKindOfClass:[NSArray class]]) {

    NSArray<NSArray *> *rows = payload;
    std::vector<std::tuple<double, int, double>> entries;
    entries.reserve(rows.count);
    for (NSArray *row in rows) {
      if (row.count < 3) continue;
      entries.emplace_back([row[0] doubleValue], [row[1] intValue], [row[2] doubleValue]);
    }
    engine->processSnapshot(entries);

    [_stateLock lock];
    _stats[sym].totalUpdates += (int64_t)rows.count;
    [_stateLock unlock];
    return;
  }

  // ── Delta ─────────────────────────────────────────────────────
  if ([payload isKindOfClass:[NSArray class]] &&
      [(NSArray *)payload count] >= 3 &&
      [((NSArray *)payload)[0] isKindOfClass:[NSNumber class]]) {

    NSArray *row = payload;
    engine->processDelta([row[0] doubleValue], [row[1] intValue], [row[2] doubleValue]);

    [_stateLock lock];
    _stats[sym].totalUpdates++;
    [_stateLock unlock];
  }
}

- (void)_handleDisconnect {
  [_stateLock lock];
  for (auto &kv : _stats) kv.second.subscribed = false;
  BOOL shouldStop  = _disconnecting;
  NSInteger delay  = _reconnectDelay;
  _reconnectDelay  = MIN(_reconnectDelay * 2, 30);
  [_stateLock unlock];

  [_wsTask cancel];
  _wsTask = nil;
  _chanIdToSymbol.clear();

  if (shouldStop) return;

  NSLog(@"[ws-native] disconnected, reconnecting in %lds...", (long)delay);
  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW, delay * NSEC_PER_SEC),
      dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0),
      ^{ [self _openSocket]; });
}

// ── Codegen JSI bridge ────────────────────────────────────────────

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeOrderbookEngineSpecJSI>(params);
}

@end
