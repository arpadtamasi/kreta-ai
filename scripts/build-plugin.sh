#!/usr/bin/env bash
# Becsomagolja a projektet letölthető Claude Code plugin ZIP-ként.
#
# A repo gyökerében lévő .mcp.json a "git clone + claude" folyamathoz való
# (${CLAUDE_PROJECT_DIR}-t vár). A plugin-telepítés (marketplace add / Claude
# Desktop "upload" / ~/.claude/skills/ mappába másolás) más környezeti
# változót ad: ${CLAUDE_PLUGIN_ROOT}. A kettő nem ugyanaz, ezért a plugin
# csomag kap egy saját .mcp.json-t.
#
# A hitelesítő adatokat (1 vagy több gyereket) a plugin manifest userConfig
# mezői kérik be Claude Code natív, biztonságos beállító-dialógusán keresztül
# (`/plugin configure kreta-mcp@kreta-mcp` vagy Claude Desktopon a plugin
# beállításai) — a jelszó mezők "sensitive" jelöltek, ezért maszkoltan
# jelennek meg és biztonságos tárolóba (kulcstartó) kerülnek, nem sima
# szövegfájlba. Egy gyereknél egy-egy bejegyzést adj meg minden mezőnél,
# többnél gyerekenként egyet, azonos sorrendben. Ezt végigteszteltük: a nem
# érzékeny mezők a settings.json-ba kerülnek, a jelszó oda nem.
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
      ],
      "env": {
        "KRETA_CHILD_NAMES": "${user_config.KRETA_CHILD_NAMES}",
        "KRETA_USERNAMES": "${user_config.KRETA_USERNAMES}",
        "KRETA_PASSWORDS": "${user_config.KRETA_PASSWORDS}",
        "KRETA_INSTITUTE_CODES": "${user_config.KRETA_INSTITUTE_CODES}"
      }
    }
  }
}
EOF

(cd "dist" && zip -rq "kreta-mcp-plugin-${VERSION}.zip" "kreta-mcp")

echo "Kész: ${ZIP_PATH}"
echo "Telepítés: unzip, majd a mappában:"
echo "  claude plugin marketplace add ."
echo "  claude plugin install kreta-mcp@kreta-mcp"
echo "Utána Claude Code-on belül: /plugin configure kreta-mcp@kreta-mcp"
echo "(vagy telepítéskor: claude plugin install kreta-mcp@kreta-mcp --config KRETA_CHILD_NAMES=... stb.)"
