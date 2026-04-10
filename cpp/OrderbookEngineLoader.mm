#import <Foundation/Foundation.h>
#include "OrderbookEngineRegistration.h"

// ObjC class with +load ensures the linker includes this file
// when -ObjC flag is set (which React Native always uses).
// +load runs before main(), guaranteeing registration before RN init.
@interface OrderbookEngineLoader : NSObject
@end

@implementation OrderbookEngineLoader
+ (void)load {
  NSLog(@"[OrderbookEngine] +load called, registering C++ TurboModule...");
  turbobook::registerOrderbookEngine();
  NSLog(@"[OrderbookEngine] Registration complete.");
}
@end
