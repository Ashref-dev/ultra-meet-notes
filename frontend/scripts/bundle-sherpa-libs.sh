#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"
APP="${APP_PATH:-$ROOT/target/release/bundle/macos/Ultra Meet.app}"
REL="$ROOT/target/release"

if [[ ! -d "$APP" ]]; then
  echo "App bundle not found at $APP"
  exit 1
fi

BIN="$APP/Contents/MacOS/ultra-meet"
FRAMEWORKS="$APP/Contents/Frameworks"

mkdir -p "$FRAMEWORKS"

for LIB in "libsherpa-onnx-c-api.dylib" "libonnxruntime.1.17.1.dylib"; do
  SRC="$REL/$LIB"
  if [[ ! -f "$SRC" ]]; then
    echo "Required dylib missing from target/release: $LIB"
    exit 1
  fi
  cp "$SRC" "$FRAMEWORKS/$LIB"
  chmod +w "$FRAMEWORKS/$LIB"
  install_name_tool -id "@rpath/$LIB" "$FRAMEWORKS/$LIB"
  codesign --force --sign - "$FRAMEWORKS/$LIB"
done

ln -sf "libonnxruntime.1.17.1.dylib" "$FRAMEWORKS/libonnxruntime.dylib"

if ! otool -l "$BIN" | grep -q "@executable_path/../Frameworks"; then
  install_name_tool -add_rpath "@executable_path/../Frameworks" "$BIN" 2>/dev/null || true
fi

codesign --force --sign - "$BIN"
codesign --force --sign - "$APP"

echo "Bundled sherpa-onnx dylibs into $APP"

DMG_DIR="$ROOT/target/release/bundle/dmg"
BUNDLE_DMG_SCRIPT="$DMG_DIR/bundle_dmg.sh"

if [[ -f "$BUNDLE_DMG_SCRIPT" ]]; then
  APP_VERSION=$(defaults read "$APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo "0.0.0")
  DMG_OUTPUT="$DMG_DIR/Ultra Meet_${APP_VERSION}_aarch64.dmg"
  STAGING_DIR=$(mktemp -d)

  cp -a "$APP" "$STAGING_DIR/"

  echo "Re-creating DMG with patched app: $DMG_OUTPUT"
  rm -f "$DMG_OUTPUT"
  PATH="/usr/bin:$PATH" bash "$BUNDLE_DMG_SCRIPT" \
    --volname "Ultra Meet" \
    --icon "Ultra Meet.app" 180 170 \
    --app-drop-link 480 170 \
    --window-size 660 400 \
    --window-pos 200 120 \
    --hide-extension "Ultra Meet.app" \
    --codesign "-" \
    --skip-jenkins \
    "$DMG_OUTPUT" \
    "$STAGING_DIR"

  rm -rf "$STAGING_DIR"
  echo "DMG created: $DMG_OUTPUT"
else
  echo "Warning: bundle_dmg.sh not found at $BUNDLE_DMG_SCRIPT — skipping DMG rebuild"
fi
