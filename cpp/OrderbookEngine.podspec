require "json"

package = JSON.parse(File.read(File.join(__dir__, "..", "package.json")))

Pod::Spec.new do |s|
  s.name         = "OrderbookEngine"
  s.version      = package["version"]
  s.summary      = "C++ orderbook engine exposed via Turbo Native Module"
  s.homepage     = "https://github.com/turbobook"
  s.license      = package["license"]
  s.author       = "turbobook"
  s.platforms    = { :ios => "15.1" }
  s.source       = { :git => "" }

  s.source_files = "*.{h,cpp,mm}"

  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
  }

  install_modules_dependencies(s)
end
