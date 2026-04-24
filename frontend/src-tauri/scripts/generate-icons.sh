#!/usr/bin/env bash
#
# generate-icons.sh — Regenerate all app + tray icon sizes from source SVGs.
#
# Prerequisites:
#   brew install librsvg imagemagick
#
# Usage:
#   cd frontend/src-tauri && bash scripts/generate-icons.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ICONS_DIR="$(cd "$SCRIPT_DIR/../icons" && pwd)"

# ─── Dependency check ─────────────────────────────────────────────────────────

check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo "Error: '$1' not found. Install with: $2" >&2
    exit 1
  fi
}

check_cmd rsvg-convert "brew install librsvg"
check_cmd magick       "brew install imagemagick"

# ─── App icon from icon_source.svg ────────────────────────────────────────────

SRC="$ICONS_DIR/icon_source.svg"
echo "Generating app icons from $SRC ..."

# Standard sizes (px)
for size in 16 32 64 128 256 512; do
  rsvg-convert -w "$size" -h "$size" "$SRC" > "$ICONS_DIR/icon_${size}x${size}.png"
  echo "  icon_${size}x${size}.png"

  double=$((size * 2))
  rsvg-convert -w "$double" -h "$double" "$SRC" > "$ICONS_DIR/icon_${size}x${size}@2x.png"
  echo "  icon_${size}x${size}@2x.png"
done

# Main icon.png (256x256)
cp "$ICONS_DIR/icon_256x256.png" "$ICONS_DIR/icon.png"
echo "  icon.png (256x256 copy)"

# ─── .icns (macOS) ────────────────────────────────────────────────────────────

ICONSET_DIR=$(mktemp -d)/AppIcon.iconset
mkdir -p "$ICONSET_DIR"

for size in 16 32 128 256 512; do
  cp "$ICONS_DIR/icon_${size}x${size}.png"    "$ICONSET_DIR/icon_${size}x${size}.png"
  cp "$ICONS_DIR/icon_${size}x${size}@2x.png" "$ICONSET_DIR/icon_${size}x${size}@2x.png"
done

iconutil -c icns "$ICONSET_DIR" -o "$ICONS_DIR/app_icon.icns"
echo "  app_icon.icns"
rm -rf "$(dirname "$ICONSET_DIR")"

# ─── .ico (Windows) ───────────────────────────────────────────────────────────

magick "$ICONS_DIR/icon_16x16.png" \
       "$ICONS_DIR/icon_32x32.png" \
       "$ICONS_DIR/icon_64x64.png" \
       "$ICONS_DIR/icon_128x128.png" \
       "$ICONS_DIR/icon_256x256.png" \
       "$ICONS_DIR/app_icon.ico"
echo "  app_icon.ico"

cp "$ICONS_DIR/app_icon.ico" "$ICONS_DIR/icon.ico"
echo "  icon.ico (copy)"

# ─── Tray icons ───────────────────────────────────────────────────────────────

for variant in tray-icon tray-icon-recording; do
  if [ "$variant" = "tray-icon" ]; then
    TRAY_SRC="$ICONS_DIR/tray_icon_source.svg"
  else
    TRAY_SRC="$ICONS_DIR/tray_icon_recording_source.svg"
  fi

  echo "Generating $variant from $TRAY_SRC ..."

  rsvg-convert -w 16 -h 16 "$TRAY_SRC" > "$ICONS_DIR/${variant}.png"
  echo "  ${variant}.png (16x16)"

  rsvg-convert -w 32 -h 32 "$TRAY_SRC" > "$ICONS_DIR/${variant}@2x.png"
  echo "  ${variant}@2x.png (32x32)"

  rsvg-convert -w 48 -h 48 "$TRAY_SRC" > "$ICONS_DIR/${variant}@3x.png"
  echo "  ${variant}@3x.png (48x48)"
done

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "Done. Generated icons in: $ICONS_DIR"
echo "Run 'file $ICONS_DIR/app_icon.icns' to verify."
