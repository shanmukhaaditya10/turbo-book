#pragma once

#include <ReactCommon/TurboModule.h>
#include <jsi/jsi.h>

#include "OrderbookEngine.h"

namespace facebook::react {

class OrderbookEngineModule : public TurboModule {
 public:
  OrderbookEngineModule(std::shared_ptr<CallInvoker> jsInvoker);

  turbobook::OrderbookEngine engine_;
};

}  // namespace facebook::react
