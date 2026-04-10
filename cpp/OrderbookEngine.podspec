require "json"

Pod::Spec.new do |s|
  s.name            = "OrderbookEngine"
  s.version         = "0.0.1"
  s.summary         = "C++ TurboModule orderbook engine"
  s.homepage        = "https://github.com/turbobook"
  s.license         = "MIT"
  s.author          = "turbobook"
  s.platforms       = { :ios => "15.1" }
  s.source          = { :git => "" }

  s.source_files    = "*.{h,cpp,mm}"
  s.header_mappings_dir = "."

  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
  }

  install_modules_dependencies(s)
end
