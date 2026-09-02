#!/usr/bin/env bash
# Becsomagolja a Claude Desktop bővítményt (dist/kreta-ai-<verzió>.mcpb).
#
# A .mcpb egy-kattintásos Desktop-telepítő: a manifest.json user_config
# mezőiből natív beállító-űrlap lesz, a jelszavak az OS kulcstartójába
# kerülnek, a szerver a Desktop saját Node-jával fut. Ez a nem technikás
# felhasználóknak szánt, ajánlott terjesztési forma.
set -euo pipefail

cd "$(dirname "$0")/../desktop"

VERSION=$(node -p "require('./manifest.json').version")
OUT="../dist/kreta-ai-${VERSION}.mcpb"

npm install --omit=dev
npm test
mkdir -p ../dist
rm -f "$OUT"
npx --yes @anthropic-ai/mcpb validate manifest.json
npx --yes @anthropic-ai/mcpb pack . "$OUT"

echo "Kész: dist/kreta-ai-${VERSION}.mcpb"
echo "Telepítés: dupla-katt a fájlra (Claude Desktop), majd a beállító-űrlap kitöltése."
