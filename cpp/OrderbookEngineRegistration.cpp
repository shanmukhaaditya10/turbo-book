#include "OrderbookEngineRegistration.h"
#include "OrderbookEngineModule.h"

#include <ReactCommon/CxxTurboModuleUtils.h>

namespace turbobook {

void registerOrderbookEngine() {
  facebook::react::registerCxxModuleToGlobalModuleMap(
      "OrderbookEngine",
      [](std::shared_ptr<facebook::react::CallInvoker> jsInvoker) {
        return std::make_shared<facebook::react::OrderbookEngineModule>(
            std::move(jsInvoker));
      });
}

}  // namespace turbobook
