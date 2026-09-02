# KRÉTA MCP

Helyben futó, csak olvasható MCP-szerver Claude Code és Claude Desktop számára,
hogy a KRÉTA-adataidról (órarend, házi, jegyek, dolgozatok, mulasztások...)
egyszerűen tudj kérdezni Claude-tól.

A szerver a KRÉTA felé OAuth 2.0 Authorization Code + PKCE folyamattal lép be,
majd rögzített, csak olvasható tanulói `GET` végpontokat tesz elérhetővé MCP
toolként. **Nincs hivatalos, hosztolt szolgáltatás** — a szerver mindig a te
gépeden fut, a te KRÉTA-hitelesítő adataiddal. Ez nem véletlen: ez a projekt
egy senki más adatához nem fér hozzá, senki mástól nem gyűjt be semmit.

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

## Plugin telepítés (letölthető ZIP, marketplace nélkül)

Ha nem akarsz a terminállal bajlódni git clone-nal: töltsd le a legfrissebb
`kreta-mcp-plugin-*.zip` fájlt a [Releases](../../releases) oldalról, majd:

- **Claude Desktop**: csomagold ki a ZIP-et, és a plugin feltöltő
  felületén válaszd ki a kicsomagolt `kreta-mcp` mappát.
- **Claude Code**: csomagold ki, majd a mappában:
  ```bash
  claude plugin marketplace add ./kreta-mcp
  claude plugin install kreta-mcp@kreta-mcp
  ```

**Nincs `.env`-fájl-keresgélés.** A hitelesítő adataidat Claude natív,
beépített beállító-dialógusa kéri be — Claude Code-on belül:

```text
/plugin configure kreta-mcp@kreta-mcp
```

(Claude Desktopon ugyanez grafikus dialógusablakban jelenik meg a plugin
beállításainál.) Ez négy mezőt kér: **Gyerek neve**, **KRÉTA
felhasználónév**, **KRÉTA jelszó**, **Intézménykód** — egy gyereknél egy-egy
bejegyzést adj meg, többnél gyerekenként egyet, azonos sorrendben (lásd
"Több gyerek" lentebb). A jelszó mező maszkoltan jelenik meg, és **nem
kerül sima szövegfájlba**: biztonságos tárolóba (kulcstartó/credentials
fájl) megy, míg a többi mező a Claude Code beállításaiba — ezt
végigteszteltük.

Ez a csomag saját, plugin-specifikus `.mcp.json`-t tartalmaz
(`${CLAUDE_PLUGIN_ROOT}`-ot használ) — ne keverd a lenti, git clone-hoz való
változattal.

Ez az út is a te géped, a te KRÉTA-adataiddal futtatja a szervert — a plugin
csak a telepítést egyszerűsíti, semmilyen adat nem megy máshova.

## Gyors indítás (git clone)

1. Telepítsd az [`uv`](https://docs.astral.sh/uv/getting-started/installation/)
   csomagkezelőt (egy parancs, Mac/Linux/Windows):
   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```
2. Töltsd le ezt a repót (`git clone` vagy ZIP), és lépj be a mappájába.
3. Másold le a `.env.example` fájlt `.env` néven, és töltsd ki a saját KRÉTA
   belépési adataiddal (lásd lentebb, "Hitelesítő adatok").
4. Indítsd el a Claude Code-ot ebben a mappában:
   ```bash
   uv sync
   claude
   ```
   Első indításkor hagyd jóvá a projekt MCP-szerverét (a `.mcp.json` már
   tartalmazza), majd ellenőrizd a `/mcp` paranccsal.
5. Kérdezz rá: *"Ellenőrizd a KRÉTA-belépést, majd mutasd meg a következő hét
   órarendjét."*

> Ha ez az egész kínaiul hangzik: kérj meg egy technikásabb családtagot (pl. a
> gyereket, akiről az adatok szólnak), hogy futtassa le a fenti 4 parancsot —
> utána már csak Claude-dal kell beszélgetni.

## Claude Desktop bekötése

A Claude Desktop konfiguráció `mcpServers` részéhez add hozzá az alábbi blokkot,
az útvonalakat a `command -v uv` kimenetére és a projekt abszolút útvonalára
cserélve. Grafikus alkalmazásnál az `uv` abszolút útvonala megbízhatóbb, mint
csak a parancs neve.

```json
{
  "mcpServers": {
    "kreta": {
      "command": "/ABSOLUTE/PATH/TO/uv",
      "args": [
        "run",
        "--directory",
        "/ABSOLUTE/PATH/TO/kreta-mcp",
        "python",
        "kreta_mcp_server.py"
      ]
    }
  }
}
```

Ezután indítsd újra a Claude Desktopot.

## Több gyerek

### Plugin telepítésnél

**Egyetlen plugin-telepítés kezeli az összes gyerekedet** — nem kell
gyerekenként külön csomag. A `/plugin configure kreta-mcp@kreta-mcp`
dialógusban minden mezőnél ("Gyerek neve", "KRÉTA felhasználónév", "KRÉTA
jelszó", "Intézménykód") adj hozzá egy-egy bejegyzést gyerekenként, mindig
ugyanabban a sorrendben — pl. előbb Marci adatai mind a négy mezőnél, utána
Benedeké. Ha a két gyereked különböző intézményben tanul, ez természetesen
működik, hisz az intézménykód is gyerekenkénti.

**Fontos**: a jelszó ne tartalmazzon vesszőt (`,`) — a program a
bejegyzéseket vesszővel választja el egymástól, és egy vesszőt tartalmazó
jelszó összezavarná a párosítást. Ha ez elkerülhetetlen, a smoke test
azonnal, egyértelmű hibaüzenettel jelzi (nem enged csendben rossz gyerekhez
párosítani adatokat).

Ezután kérdezz rá névvel: *"Mi van Marcinak a héten?"* — Claude a tool
`child` paraméterében fogja átadni a nevet. Ha csak egy gyerek van
beállítva, a `child` paramétert soha nem kell megadni.

### Git clone telepítésnél

Ha a projektet klónoztad (nem plugin), a plugin fenti, vesszős listás
módszere is működik (állítsd be ugyanezt a négy környezeti változót a
`.env`-ben: `KRETA_CHILD_NAMES`, `KRETA_USERNAMES`, `KRETA_PASSWORDS`,
`KRETA_INSTITUTE_CODES`), de nem kell — külön `.env` fájlokkal is
megoldható, nem kell külön klón gyerekenként:

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

Ha a két gyereked különböző intézményben tanul, ez amúgy is működik, mert a
`KRETA_INSTITUTE_CODE` gyerekenkénti, a `.env.<nev>` fájlokban külön-külön
állítható be. Ha ugyanabban az intézményben tanulnak és neked mint
gondviselőnek egy közös bejelentkezésed van mindkettőjükhöz, előfordulhat,
hogy ugyanazokat a hitelesítő adatokat kell megadnod mindkét `.env.<nev>`
fájlban — ezt a KRÉTA-fiókod pontos beállítása dönti el, kísérletezz.

## Elérhető MCP toolok

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

Nincs módosító/törlő tool, tetszőleges API-útvonal és automatikus
csatolmány-letöltés.

## Biztonság és adatvédelem

Az MCP toolok válaszai személyes oktatási adatokat tartalmazhatnak, amelyeket
Claude megkap a kérés teljesítéséhez. Csak olyan Claude-környezetbe kösd be,
amelyben ezt vállalod, és csak saját vagy erre kijelölt tesztfiókot használj.

Az access és refresh token csak memóriában marad. A refresh tokent a szerver
leálláskor visszavonja. A jelszó nem MCP tool-paraméter, ezért nem kerül Claude
beszélgetési előzményeibe vagy tool-hívásába.

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

Több gyerekhez lásd a "Több gyerek" szakaszt — plugin telepítésnél ezt egy
natív, biztonságos dialógus kéri be, git clone-nál a `KRETA_CHILD_NAMES` /
`KRETA_USERNAMES` / `KRETA_PASSWORDS` / `KRETA_INSTITUTE_CODES` (vesszővel
elválasztott lista) vagy külön `.env` fájlok valamelyikét használhatod.

## Közvetlen ellenőrzés

```bash
uv sync
uv run python kreta_smoke_test.py
```

Siker esetén a program ezt írja ki:

```text
SIKER: a bejelentkezés és az olvasási API-kérés működik.
```

Hiba esetén nem ír ki tokent, jelszót vagy személyes tanulói adatot.

## Összes olvasási végpont próbája

A dokumentált tanulói `GET` végpontokat egyetlen bejelentkezéssel így lehet
ellenőrizni:

```bash
uv run python kreta_read_probe.py
```

A program csak HTTP-státuszt és elemszámot ír ki. Az azonosítót igénylő
részletező végpontokhoz a listaválaszból vesz egy azonosítót, de azt sem írja
ki. A csatolmány-letöltést szándékosan kihagyja.

## Fejlesztés

```bash
uv sync
uv run python -m unittest discover -s tests
```

A plugin ZIP újragenerálása (`dist/kreta-mcp-plugin-<verzió>.zip`):

```bash
./scripts/build-plugin.sh
```

## Licenc

[Apache License 2.0](LICENSE) — a kódra vonatkozik, "AS IS" szavatosság
nélkül. Nem ad és nem is adhat semmilyen jogot a KRÉTA rendszeréhez, nevéhez
vagy védjegyéhez; azok a jogtulajdonosukat illetik.
