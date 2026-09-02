# KRÉTA AI

Helyben futó, csak olvasható integráció Claude-hoz, hogy a KRÉTA-adataidról
(órarend, házi, jegyek, dolgozatok, mulasztások...) egyszerűen tudj
kérdezni.

A program a KRÉTA felé OAuth 2.0 Authorization Code + PKCE folyamattal lép
be, majd rögzített, csak olvasható tanulói `GET` végpontokat kérdez le.
**Nincs hivatalos, hosztolt szolgáltatás** — mindig a te gépeden fut, a te
KRÉTA-hitelesítő adataiddal. Ez nem véletlen: ez a projekt senki más
adatához nem fér hozzá, senki mástól nem gyűjt be semmit.

Háromféle módon érhető el, a telepítési módtól függően:
- **Claude Desktop bővítmény (`.mcpb`) — ez az ajánlott.** Letöltesz egy
  fájlt, duplán kattintasz rá, és a Claude Desktop natív űrlapján megadod a
  gyerek(ek) adatait. Nem kell hozzá terminál, se Python: a szervert a
  Desktop saját Node-ja futtatja, a jelszavak a gép kulcstartójába kerülnek.
  (Fizetős Claude-csomag kell hozzá: Pro/Max/Team.)
- **Plugin (skill)** — letölthető ZIP, Claude Bash tool-lal futtatja a
  `python/kreta_cli.py` parancssoros scriptet. Ez működik a claude.ai
  weben is, nem csak Claude Code-ban.
- **Git clone (MCP-szerver)** — a hagyományos, `python/kreta_mcp_server.py`-t
  használó út Claude Code-hoz vagy kézzel bekötött Claude Desktop
  MCP-szerverként, technikásabb felhasználóknak.

## Nem hivatalos projekt — olvasd el, mielőtt használod

- Ez a projekt **nem áll kapcsolatban az eKRÉTA Zrt.-vel** és nem hivatalos
  KRÉTA-termék. A "KRÉTA" név a jogtulajdonosé.
- A KRÉTA tanulói API nem nyilvános, hivatalosan dokumentált integrációs API;
  a belépési folyamat vagy a végpontok értesítés nélkül megváltozhatnak, és
  ettől a projekt működése is megszakadhat.
- A szoftver **"AS IS"**, mindenféle szavatosság nélkül kerül közzétételre
  (lásd [LICENSE](LICENSE), Apache License 2.0) — a használat saját felelősségre
  történik.
- Senki nem üzemelteti ezt szolgáltatásként a te nevedben: a hitelesítő
  adataid csak a saját gépeden lévő `.env` fájlban és a memóriában léteznek,
  sosem hagyják el a gépedet, kivéve a KRÉTA saját szervere felé.
- **Felhős Claude-munkamenetben (pl. Cowork) nem fog működni**, még ha a
  plugin telepítve is van: az ilyen munkamenetek konténerének nincs
  hálózati elérése a KRÉTA szerverei felé.

## Claude Desktop bővítmény (ajánlott, nem technikás szülőknek)

1. Töltsd le a legfrissebb `kreta-ai-*.mcpb` fájlt a
   [Releases](../../releases) oldalról.
2. Kattints rá duplán (vagy Claude Desktop → Settings → Extensions →
   Install extension…), és hagyd jóvá a telepítést.
3. A megjelenő űrlapon add meg az 1. gyerek nevét, KRÉTA-azonosítóját,
   jelszavát és az iskola kódját. Ha több gyereked van, töltsd ki a 2. és
   3. gyerek mezőit is; ha nincs, hagyd üresen őket.
4. Kész — kérdezz a Chat fülön: *"Mi a házi holnapra?"*, *"Milyen jegyeket
   kapott Marci a héten?"*

A jelszavak a rendszer kulcstartójában tárolódnak (macOS Keychain / Windows
Credential Manager), a lekérdezések a te gépedről mennek közvetlenül a KRÉTA
szerveréhez. A bővítményhez fizetős Claude-csomag kell (Pro/Max/Team);
Claude Desktop macOS-en és Windowson érhető el.

## Plugin telepítés (letölthető ZIP, claude.ai webhez)

Töltsd le a legfrissebb `kreta-ai-plugin-*.zip` fájlt a
[Releases](../../releases) oldalról, csomagold ki, majd:

- **Claude Desktop / claude.ai web**: Customize → Plugins → add hozzá a
  kicsomagolt `kreta-ai` mappát.
- **Claude Code**: a kicsomagolt mappában
  ```bash
  claude plugin marketplace add ./kreta-ai
  claude plugin install kreta-ai@kreta-ai
  ```

Ezután keresd meg, hova telepítette Claude a plugint (Claude Code-ban:
`claude plugin details kreta-ai`), és **abban a mappában** másold a
`.env.example` fájlt `.env` néven, és töltsd ki a saját KRÉTA
felhasználóneveddel, jelszavaddal és az iskola intézménykódjával (lásd
lentebb, "Hitelesítő adatok"). Nincs natív beállító-dialógus — ez a
legegyszerűbb, legkevésbé törékeny út, amit végig tudtunk tesztelni.

Ezután kérdezz rá: *"Mi a házi mára?"*, *"Mikor van a következő dolgozat?"*

## Gyors indítás (git clone, Claude Code-hoz)

1. Telepítsd az [`uv`](https://docs.astral.sh/uv/getting-started/installation/)
   csomagkezelőt (egy parancs, Mac/Linux/Windows):
   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```
2. Töltsd le ezt a repót (`git clone` vagy ZIP), és lépj be a mappájába.
3. Másold le a `python/.env.example` fájlt `python/.env` néven, és töltsd ki
   a saját KRÉTA belépési adataiddal (lásd lentebb, "Hitelesítő adatok").
4. Indítsd el a Claude Code-ot a repó gyökerében:
   ```bash
   (cd python && uv sync)
   claude
   ```
   Első indításkor hagyd jóvá a projekt MCP-szerverét (a `.mcp.json` már
   tartalmazza), majd ellenőrizd a `/mcp` paranccsal.
5. Kérdezz rá: *"Ellenőrizd a KRÉTA-belépést, majd mutasd meg a következő hét
   órarendjét."*

> Ha ez az egész kínaiul hangzik: kérj meg egy technikásabb családtagot (pl. a
> gyereket, akiről az adatok szólnak), hogy futtassa le a fenti 4 parancsot —
> utána már csak Claude-dal kell beszélgetni.

## Claude Desktop kézi MCP-bekötése (haladóknak)

Ez a klasszikus, plugin nélküli Desktop-integráció — nem a fenti plugin
mechanizmus, hanem a Desktop saját `mcpServers` configja, ami MCP-szerverként
tudja futtatni a `kreta_mcp_server.py`-t (Claude Desktopon ez is a Chat
fülön elérhetővé teszi a toolokat, mert nem plugin-csomagolású). Add hozzá
az alábbi blokkot a Desktop configjához, az útvonalakat a `command -v uv`
kimenetére és a projekt abszolút útvonalára cserélve — grafikus
alkalmazásnál az `uv` abszolút útvonala megbízhatóbb, mint csak a parancs
neve:

```json
{
  "mcpServers": {
    "kreta": {
      "command": "/ABSOLUTE/PATH/TO/uv",
      "args": [
        "run",
        "--directory",
        "/ABSOLUTE/PATH/TO/kreta-ai/python",
        "python",
        "kreta_mcp_server.py"
      ]
    }
  }
}
```

Ezután indítsd újra a Claude Desktopot.

## Több gyerek

### Desktop bővítménynél

A beállító-űrlapon egyszerűen töltsd ki a 2. (és 3.) gyerek mezőcsoportját
is — gyerekenként név, azonosító, jelszó, iskolakód. Az intézménykódot
testvéreknél is add meg, akkor is, ha ugyanabba az iskolába járnak. Utána
kérdezz névvel: *"Mi van Marcinak a héten?"*

### Plugin telepítésnél

**Egyetlen plugin-telepítés kezeli az összes gyerekedet.** A telepített
plugin mappájában lévő `.env` fájlban a `.env.example` megjegyzései szerint
add meg a vesszővel elválasztott listás mezőket (`KRETA_CHILD_NAMES`,
`KRETA_USERNAMES`, `KRETA_PASSWORDS`, `KRETA_INSTITUTE_CODES`), gyerekenként
egy-egy bejegyzést, mindig azonos sorrendben — pl. előbb Marci adatai mind a
négy mezőnél, utána Benedeké. Ha a két gyereked különböző intézményben
tanul, ez természetesen működik, hisz az intézménykód is gyerekenkénti.

**Fontos**: a jelszó ne tartalmazzon vesszőt (`,`) — a bejegyzéseket a
program vesszővel választja el egymástól, és egy vesszőt tartalmazó jelszó
összezavarná a párosítást. Ha ez elkerülhetetlen, a program azonnal,
egyértelmű hibaüzenettel jelzi (nem enged csendben rossz gyerekhez
párosítani adatokat).

Ezután kérdezz rá névvel: *"Mi van Marcinak a héten?"* — a skill a `--child`
kapcsolóval adja át a nevet a lekérdező scriptnek. Ha csak egy gyerek van
beállítva, ezt sosem kell megadni.

### Git clone telepítésnél

Ugyanez a vesszős listás módszer itt is működik (állítsd be a fenti négy
környezeti változót a `.env`-ben), de nem kötelező — külön `.env` fájlokkal
is megoldható, nem kell külön klón gyerekenként:

1. Hozz létre gyerekenként egy külön `.env` fájlt, pl. `.env.deak` és
   `.env.kata` (ezek a mintafájl `.env*` mintája miatt automatikusan ki
   vannak zárva a Gitből). Opcionálisan add meg a `KRETA_LABEL`-t is, hogy a
   `kreta_login` válaszában lásd, melyik gyerekről van szó.
2. Regisztráld mindkettőt külön kulcs alatt a `.mcp.json`-ban (vagy a Claude
   Desktop configjában), a `KRETA_ENV_FILE` környezeti változóval jelölve,
   melyik fájlt töltse be:
   ```json
   {
     "mcpServers": {
       "kreta-deak": {
         "type": "stdio",
         "command": "uv",
         "args": ["run", "--directory", "${CLAUDE_PROJECT_DIR:-.}", "python", "kreta_mcp_server.py"],
         "env": { "KRETA_ENV_FILE": ".env.deak" }
       },
       "kreta-kata": {
         "type": "stdio",
         "command": "uv",
         "args": ["run", "--directory", "${CLAUDE_PROJECT_DIR:-.}", "python", "kreta_mcp_server.py"],
         "env": { "KRETA_ENV_FILE": ".env.kata" }
       }
     }
   }
   ```
3. Claude-ban a toolok a szerverkulcs szerint jelennek meg (pl.
   `kreta-deak: kreta_homework` vs. `kreta-kata: kreta_homework`), így nem
   keverednek össze — kérdezz külön mindkét gyerekről.

## Elérhető lekérdezések

- OAuth/PKCE belépés ellenőrzése
- tanulói és gondviselői adatlap
- osztályok és csoportok
- értékelések, mulasztások és feljegyzések
- órarend és órarendi részlet
- házi feladatok és házi feladat részlet
- bejelentett számonkérések
- fogadóórák és fogadóóra-részlet
- faliújság, tanév rendje és hetirend
- osztályátlagok, eszközállapot és Lázár Ervin Program

Nincs módosító/törlő művelet, tetszőleges API-útvonal és automatikus
csatolmány-letöltés. Plugin telepítésnél ezek a `kreta_cli.py` parancsai
(lásd `skills/kreta/SKILL.md`), git clone-nál ugyanezek MCP toolként
(`kreta_mcp_server.py`).

## Biztonság és adatvédelem

A lekérdezések válaszai személyes oktatási adatokat tartalmazhatnak,
amelyeket Claude megkap a kérés teljesítéséhez. Csak olyan
Claude-környezetbe telepítsd, amelyben ezt vállalod, és csak saját vagy erre
kijelölt tesztfiókot használj.

Az access és refresh token csak memóriában marad. A refresh tokent a
program leálláskor visszavonja (MCP-szerver módban). A jelszó sosem tool-
vagy parancssori paraméter, ezért nem kerül Claude beszélgetési
előzményeibe vagy tool-/parancs-hívásába — mindig a `.env` fájlból olvassa
be közvetlenül a Python folyamat.

## Hitelesítő adatok

A helyi `.env` fájlban töltsd ki:

```dotenv
KRETA_USERNAME="sajat-azonosito"
KRETA_PASSWORD="sajat-jelszo"
KRETA_INSTITUTE_CODE="az-intezmeny-hosszabb-kodja"
```

A `.env` (és minden `.env.*` fájl az `.env.example` kivételével) eleve
szerepel a `.gitignore` fájlban. A jelszót idézőjelek közé érdemes tenni,
különösen akkor, ha szóközt vagy `#` karaktert tartalmaz.

Az intézménykódot a KRÉTA intézménykeresőjében találod. Megadhatod önmagában a
kódot, az `iskolakod.e-kreta.hu` hosztnevet vagy a teljes
`https://iskolakod.e-kreta.hu` címet is; a program normalizálja.

Több gyerekhez lásd a "Több gyerek" szakaszt: a `KRETA_CHILD_NAMES` /
`KRETA_USERNAMES` / `KRETA_PASSWORDS` / `KRETA_INSTITUTE_CODES` (vesszővel
elválasztott lista) vagy külön `.env` fájlok valamelyikét használhatod.

## Közvetlen ellenőrzés

```bash
cd python
uv sync
uv run python kreta_smoke_test.py
```

Siker esetén a program ezt írja ki:

```text
SIKER: a bejelentkezés és az olvasási API-kérés működik.
```

Hiba esetén nem ír ki tokent, jelszót vagy személyes tanulói adatot.

A skill parancsai közvetlenül is kipróbálhatók:

```bash
cd python && uv run python kreta_cli.py homework
```

## Összes olvasási végpont próbája

A dokumentált tanulói `GET` végpontokat egyetlen bejelentkezéssel így lehet
ellenőrizni:

```bash
cd python && uv run python kreta_read_probe.py
```

A program csak HTTP-státuszt és elemszámot ír ki. Az azonosítót igénylő
részletező végpontokhoz a listaválaszból vesz egy azonosítót, de azt sem írja
ki. A csatolmány-letöltést szándékosan kihagyja.

## Fejlesztés

A repó felépítése:

- `desktop/` — a Claude Desktop bővítmény (Node.js MCP-szerver + manifest)
- `python/` — a Python MCP-szerver, CLI és tesztek (plugin / git clone út)
- `skills/`, `.claude-plugin/` — a plugin-változat skillje és manifestje
- `scripts/` — csomagoló scriptek

Python tesztek:

```bash
cd python && uv sync && uv run python -m unittest discover -s tests
```

Node tesztek:

```bash
cd desktop && npm install && npm test
```

A Desktop bővítmény újracsomagolása (`dist/kreta-ai-<verzió>.mcpb`):

```bash
./scripts/build-mcpb.sh
```

A plugin ZIP újragenerálása (`dist/kreta-ai-plugin-<verzió>.zip`):

```bash
./scripts/build-plugin.sh
```

## Licenc

[Apache License 2.0](LICENSE) — a kódra vonatkozik, "AS IS" szavatosság
nélkül. Nem ad és nem is adhat semmilyen jogot a KRÉTA rendszeréhez, nevéhez
vagy védjegyéhez; azok a jogtulajdonosukat illetik.
