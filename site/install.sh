#!/bin/sh
# pirep installer. Downloads the latest release and unpacks it into /Applications.
# Nothing else is touched: no sudo, no login items, no background agent.
set -eu

REPO=garamnohhh/pirep
URL=https://github.com/$REPO/releases/latest/download/pirep.app.tar.gz
DEST=${DEST:-/Applications}
APP=$DEST/pirep.app

die() { echo "" >&2; echo "$1" >&2; exit 1; }

# 1. macOS on Apple silicon only, for now.
[ "$(uname -s)" = "Darwin" ] || die "pirep runs on macOS. Windows and Linux are on the way."
[ "$(uname -m)" = "arm64" ] || die "pirep is built for Apple silicon (arm64). This Mac reports $(uname -m)."

# 2. The destination has to be writable without sudo.
mkdir -p "$DEST" 2>/dev/null || true
[ -w "$DEST" ] || die "Cannot write to $DEST. Install into your home folder instead:
  curl -fsSL https://pirep.garamnoh.workers.dev/install.sh | DEST=\"\$HOME/Applications\" sh"

# 3. Say what happens to an existing copy, then do it.
if [ -d "$APP" ]; then echo "Replacing the copy already in $DEST."; fi

echo "Downloading… $URL"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "$URL" -o "$TMP/pirep.app.tar.gz" || die "Download failed. Check your connection, or open $URL in a browser."
tar -xzf "$TMP/pirep.app.tar.gz" -C "$TMP" || die "Could not unpack the download. The file may be truncated."
[ -d "$TMP/pirep.app" ] || die "The download did not contain pirep.app."

rm -rf "$APP"
mv "$TMP/pirep.app" "$APP"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

echo ""
echo "Installed → $APP"
echo "Open it:   open -a pirep"
echo "Remove it: rm -rf $APP"
