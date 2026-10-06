#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$ROOT/src-tauri/target"
EXT="$TARGET/quicklook-extension/PirepPreview.appex"
MODULE_CACHE="$TARGET/quicklook-swift-module-cache"
EXT_ID="${QL_EXTENSION_ID:-com.garamnoh.pirep.preview}"

pnpm exec vite build --config "$ROOT/quicklook/renderer/vite.config.ts"
QL_RENDERER_BUNDLE=math pnpm exec vite build --config "$ROOT/quicklook/renderer/vite.config.ts"
QL_RENDERER_BUNDLE=shiki pnpm exec vite build --config "$ROOT/quicklook/renderer/vite.config.ts"
QL_RENDERER_BUNDLE=mermaid pnpm exec vite build --config "$ROOT/quicklook/renderer/vite.config.ts"

mkdir -p "$EXT/Contents/MacOS" "$EXT/Contents/Resources" "$MODULE_CACHE"
ditto "$TARGET/quicklook-renderer" "$EXT/Contents/Resources/Renderer"
cp "$ROOT/quicklook/PirepPreview-Info.plist" "$EXT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $EXT_ID" "$EXT/Contents/Info.plist"

DEVELOPER_DIR=/Library/Developer/CommandLineTools \
  /usr/bin/swiftc \
  -sdk "$(DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer /usr/bin/xcrun --sdk macosx --show-sdk-path)" \
  -module-cache-path "$MODULE_CACHE" \
  -target arm64-apple-macosx12.0 \
  -module-name PirepPreview \
  -swift-version 5 \
  -parse-as-library \
  -application-extension \
  -Xlinker -e -Xlinker _NSExtensionMain \
  -framework AppKit -framework QuickLookUI -framework WebKit \
  "$ROOT/quicklook/PirepPreview.swift" \
  -o "$EXT/Contents/MacOS/PirepPreview"

plutil -lint "$EXT/Contents/Info.plist" "$ROOT/quicklook/PirepPreview.entitlements"
codesign --force --sign - --identifier "$EXT_ID" \
  --entitlements "$ROOT/quicklook/PirepPreview.entitlements" "$EXT"
codesign --verify --strict --verbose=2 "$EXT"
echo "Quick Look extension built and signed: $EXT"
codesign -d --entitlements :- "$EXT" 2>&1
