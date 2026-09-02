#!/usr/bin/env bash
# Becsomagolja a projektet letölthető Claude Code plugin ZIP-ként.
#
# A repo gyökerében lévő .mcp.json a "git clone + claude" folyamathoz való
# (${CLAUDE_PROJECT_DIR}-t vár). A plugin-telepítés (marketplace add / Claude
# Desktop "upload" / ~/.claude/skills/ mappába másolás) más környezeti
# változót ad: ${CLAUDE_PLUGIN_ROOT}. A kettő nem ugyanaz, ezért a plugin
# csomag kap egy saját .mcp.json-t — ezt teszteltük is (lásd README "Plugin
# telepítés" szakasz).
#
# Több gyerekhez: adj meg egy profilnevet (pl. "marci"), ekkor a plugin
# egyedi néven (kreta-mcp-marci) épül, hogy egyszerre, ütközés nélkül lehessen
# telepíteni több példányt, mindegyiket a saját .env-jével. Lásd README
# "Több gyerek" szakasza.
set -euo pipefail

cd "$(dirname "$0")/.."

PROFILE="${1:-}"
if [ -n "$PROFILE" ]; then
  PLUGIN_NAME="kreta-mcp-${PROFILE}"
else
  PLUGIN_NAME="kreta-mcp"
fi

VERSION=$(python3 -c "import tomllib; print(tomllib.load(open('pyproject.toml','rb'))['project']['version'])")
DIST_DIR="dist/${PLUGIN_NAME}"
ZIP_PATH="dist/${PLUGIN_NAME}-plugin-${VERSION}.zip"

rm -rf "dist"
mkdir -p "$DIST_DIR/.claude-plugin"

cp kreta_client.py kreta_mcp_server.py kreta_read_probe.py kreta_smoke_test.py \
   pyproject.toml uv.lock README.md LICENSE .env.example \
   "$DIST_DIR/"

cat > "$DIST_DIR/.claude-plugin/plugin.json" <<EOF
{
  "name": "${PLUGIN_NAME}",
  "version": "${VERSION}",
  "description": "Helyi, csak olvasható KRÉTA MCP-szerver Claude-hoz. Nem hivatalos, nem az eKRÉTA Zrt. terméke.",
  "license": "Apache-2.0",
  "repository": "https://github.com/arpadtamasi/kreta-mcp",
  "keywords": ["kreta", "mcp", "education", "read-only"]
}
EOF

# A "marketplace add" parancs marketplace.json-t vár a megadott útvonalon –
# ez teszi a ZIP-et önmagában (külső marketplace-repo nélkül) telepíthetővé.
cat > "$DIST_DIR/.claude-plugin/marketplace.json" <<EOF
{
  "name": "${PLUGIN_NAME}",
  "version": "${VERSION}",
  "description": "KRÉTA MCP – helyi telepítés",
  "owner": { "name": "Árpád Tamási" },
  "plugins": [
    { "name": "${PLUGIN_NAME}", "version": "${VERSION}", "source": "." }
  ]
}
EOF

cat > "$DIST_DIR/.mcp.json" <<'EOF'
{
  "mcpServers": {
    "kreta": {
      "type": "stdio",
      "command": "uv",
      "args": [
        "run",
        "--directory",
        "${CLAUDE_PLUGIN_ROOT}",
        "python",
        "kreta_mcp_server.py"
      ]
    }
  }
}
EOF

(cd "dist" && zip -rq "$(basename "$ZIP_PATH")" "$(basename "$DIST_DIR")")

echo "Kész: ${ZIP_PATH}"
echo "Telepítés: unzip, majd a mappában:"
echo "  claude plugin marketplace add ."
echo "  claude plugin install ${PLUGIN_NAME}@${PLUGIN_NAME}"
