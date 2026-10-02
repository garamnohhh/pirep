#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROTO_ROOT="/Users/garam/workspace/personal/pirep-ql-proto"
APP="$PROTO_ROOT/pirep-qlproto.app"
SOURCE_APP="$ROOT/src-tauri/target/release/bundle/macos/pirep.app"
EXT_ID="com.garamnoh.pirep.qlproto.preview"
APP_ID="com.garamnoh.pirep.qlproto"
EXT="$APP/Contents/PlugIns/PirepPreview.appex"

if [[ ! -d "$SOURCE_APP" ]]; then
  echo "Missing prebuilt app: $SOURCE_APP" >&2
  echo "Build it first with: pnpm tauri build --bundles app" >&2
  exit 1
fi
if [[ "$APP" != "$PROTO_ROOT/pirep-qlproto.app" || -L "$APP" ]]; then
  echo "Refusing to replace unexpected output path: $APP" >&2
  exit 1
fi

mkdir -p "$PROTO_ROOT/samples" "$PROTO_ROOT/build/swift-module-cache"
pnpm exec vite build --config "$ROOT/quicklook/renderer/vite.config.ts"
QL_RENDERER_BUNDLE=mermaid pnpm exec vite build --config "$ROOT/quicklook/renderer/vite.config.ts"
cp "$ROOT"/quicklook/samples/*.md "$PROTO_ROOT/samples/"

if [[ -e "$APP" ]]; then
  rm -rf "$APP"
fi
ditto "$SOURCE_APP" "$APP"

mkdir -p "$EXT/Contents/MacOS" "$EXT/Contents/Resources"
cp "$ROOT/quicklook/PirepPreview-Info.plist" "$EXT/Contents/Info.plist"
ditto "$ROOT/src-tauri/target/quicklook-renderer" "$EXT/Contents/Resources/Renderer"

DEVELOPER_DIR=/Library/Developer/CommandLineTools \
  /usr/bin/swiftc \
  -sdk "$(DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer /usr/bin/xcrun --sdk macosx --show-sdk-path)" \
  -module-cache-path "$PROTO_ROOT/build/swift-module-cache" \
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
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $APP_ID" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName pirep-qlproto" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName pirep-qlproto" "$APP/Contents/Info.plist"
codesign --force --sign - --identifier "$APP_ID" "$APP"

codesign --verify --strict --verbose=2 "$EXT"
codesign --verify --strict --verbose=2 "$APP"
echo "Extension entitlements:"
codesign -d --entitlements :- "$EXT" 2>&1

open -n -gj -a "$APP"
sleep 2
osascript -e "tell application id \"$APP_ID\" to quit"
qlmanage -r
echo "Registered Quick Look extension:"
pluginkit -m -v -i "$EXT_ID"
echo "Prototype app: $APP"
echo "Markdown samples: $PROTO_ROOT/samples"
