#!/usr/bin/env bash
# Becsomagolja a projektet letölthető Claude plugin ZIP-ként.
#
# A plugin egy SKILLT tartalmaz (skills/kreta/), ami a kreta_cli.py
# parancssoros scriptet futtatja a Bash tool-lal — NEM MCP-szervert. Ennek
# oka: a pluginba csomagolt MCP-szerver csak Claude Code / Cowork
# sessionben fut, a Desktop/web Chat fülön nem — ott csak a skillek
# aktiválódnak. A skill mindenhol működik, ahol a plugin telepíthető.
#
# (A git-clone flow változatlan: az a root .mcp.json-t és kreta_mcp_server.py-t
# használja, ${CLAUDE_PROJECT_DIR}-vel, Claude Code-hoz — az MCP ott működik.)
#
# A hitelesítő adatokat a plugin mappájában lévő .env fájl adja (másold a
# .env.example-ből) — nincs natív beállító-dialógus, mert nincs userConfig/
# MCP-szerver, amihez kötődne.
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(python3 -c "import tomllib; print(tomllib.load(open('python/pyproject.toml','rb'))['project']['version'])")
DIST_DIR="dist/kreta-ai"
ZIP_PATH="dist/kreta-ai-plugin-${VERSION}.zip"

rm -rf "$DIST_DIR" "$ZIP_PATH"
mkdir -p "dist"
mkdir -p "$DIST_DIR/.claude-plugin"
mkdir -p "$DIST_DIR/skills/kreta"

cp python/kreta_client.py python/kreta_cli.py python/kreta_smoke_test.py \
   python/pyproject.toml python/uv.lock python/.env.example README.md LICENSE \
   "$DIST_DIR/"
cp .claude-plugin/plugin.json "$DIST_DIR/.claude-plugin/plugin.json"
cp skills/kreta/SKILL.md "$DIST_DIR/skills/kreta/SKILL.md"

# A "marketplace add" parancs marketplace.json-t vár a megadott útvonalon –
# ez teszi a ZIP-et önmagában (külső marketplace-repo nélkül) telepíthetővé.
cat > "$DIST_DIR/.claude-plugin/marketplace.json" <<EOF
{
  "name": "kreta-ai",
  "version": "${VERSION}",
  "description": "KRÉTA skill – helyi telepítés",
  "owner": { "name": "Árpád Tamási" },
  "plugins": [
    { "name": "kreta-ai", "version": "${VERSION}", "source": "." }
  ]
}
EOF

(cd "dist" && zip -rq "kreta-ai-plugin-${VERSION}.zip" "kreta-ai")

echo "Kész: ${ZIP_PATH}"
echo "Telepítés: unzip, majd a mappában:"
echo "  claude plugin marketplace add ."
echo "  claude plugin install kreta-ai@kreta-ai"
echo "Utána: keresd meg, hova telepítette Claude a plugint"
echo "(claude plugin details kreta-ai), és abban a mappában"
echo "másold a .env.example-t .env néven, majd töltsd ki."
