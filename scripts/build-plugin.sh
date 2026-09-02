#!/usr/bin/env bash
# Becsomagolja a projektet letölthető Claude Code plugin ZIP-ként.
#
# A repo gyökerében lévő .mcp.json a "git clone + claude" folyamathoz való
# (${CLAUDE_PROJECT_DIR}-t vár). A plugin-telepítés (marketplace add / Claude
# Desktop "upload" / ~/.claude/skills/ mappába másolás) más környezeti
# változót ad: ${CLAUDE_PLUGIN_ROOT}. A kettő nem ugyanaz, ezért a plugin
# csomag kap egy saját .mcp.json-t — ezt teszteltük is (lásd README "Plugin
# telepítés" szakasz).
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(python3 -c "import tomllib; print(tomllib.load(open('pyproject.toml','rb'))['project']['version'])")
DIST_DIR="dist/kreta-mcp"
ZIP_PATH="dist/kreta-mcp-plugin-${VERSION}.zip"

rm -rf "dist"
mkdir -p "$DIST_DIR/.claude-plugin"

cp kreta_client.py kreta_mcp_server.py kreta_read_probe.py kreta_smoke_test.py \
   pyproject.toml uv.lock README.md LICENSE .env.example \
   "$DIST_DIR/"
cp .claude-plugin/plugin.json "$DIST_DIR/.claude-plugin/plugin.json"

# A "marketplace add" parancs marketplace.json-t vár a megadott útvonalon –
# ez teszi a ZIP-et önmagában (külső marketplace-repo nélkül) telepíthetővé.
cat > "$DIST_DIR/.claude-plugin/marketplace.json" <<EOF
{
  "name": "kreta-mcp",
  "version": "${VERSION}",
  "description": "KRÉTA MCP – helyi telepítés",
  "owner": { "name": "Árpád Tamási" },
  "plugins": [
    { "name": "kreta-mcp", "version": "${VERSION}", "source": "." }
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

(cd "dist" && zip -rq "kreta-mcp-plugin-${VERSION}.zip" "kreta-mcp")

echo "Kész: ${ZIP_PATH}"
