# Pocket Farm

Casualowa gra farmerska 2D (widok z góry) na iPhone'a: Safari 26 / iOS 26, PWA działające offline.

Stos: TypeScript 7 (strict) · Phaser 4.1 (TilemapGPULayer, SpriteGPULayer, oświetlenie, filtry) · Vite 8 · Vitest 5 · Web Worker · idb-keyval · vite-plugin-pwa (Workbox).

## Systemy gry

| System | Gdzie | Dane |
| --- | --- | --- |
| Pory roku i pogoda (deszcz podlewa, upał wysusza, uprawy więdną poza sezonem) | `sim/calendar.ts`, `sim/systems/fields.ts` | `weather.json`, `crops.json` |
| Dzień i noc (oświetlenie Phasera, latarnie, świecące rośliny nocne) | `render/layers/Lighting.ts` | `buildings.json` (`light`) |
| Gleba: wilgoć, żyzność, nawozy, płodozmian | `sim/systems/fields.ts` | `crops.json` (`soil`), `items.json` (`fertility`) |
| Jakość plonów: zwykła / srebrna ★ / złota ★★ | `fields.ts`, `animals.ts`, `exploration.ts` | – |
| Zwierzęta: głód, sympatia, produkty | `sim/systems/animals.ts` | `animals.json` |
| Przetwórstwo z kolejkami (pszenica → mąka → chleb) | `sim/systems/processing.ts` | `recipes.json` |
| Rynek dynamiczny (nasycenie, popyt dnia, festyny) | `sim/systems/market.ts` | `items.json` |
| Mieszkańcy: zamówienia, prezenty, serca i nagrody | `sim/systems/village.ts` | `npcs.json` |
| Drzewko umiejętności (rolnictwo, hodowla, handel) | `sim/systems/skills.ts`, `ctx.mod()` | `skills.json` |
| Budowanie i dekoracje (swobodne rozmieszczanie) | `sim/systems/building.ts`, `ui/buildMode.ts` | `buildings.json` |
| Festyny, zadania dzienne/tygodniowe, osiągnięcia | `sim/systems/progress.ts` | `festivals.json`, `quests.json`, `achievements.json` |
| Mapa proceduralna z mgłą, zbieractwo, łowienie | `sim/world.ts`, `sim/systems/exploration.ts` | `forage.json`, `fish.json` |
| Samouczek | `sim/systems/tutorial.ts`, `ui/tutorial.ts` | `tutorial.json` |

## Widok 2.5D (izometria)

- Rzut izometryczny 2:1 (`render/iso.ts`): logika gry zostaje na siatce kafli, `project()`/`unproject()` przeliczają kafle ↔ ekran.
- Ziemia to nadal **TilemapGPULayer** (Phaser obsługuje w nim tylko rzut ortogonalny): warstwa siedzi w kontenerze obróconym o 45° wewnątrz kontenera spłaszczonego w Y ×0,5, co daje dokładnie romby izometryczne przy tym samym koszcie GPU. Nakładki leżące na ziemi (podświetlenie, obrys budowy) są w tym samym kontenerze.
- Rośliny, drzewa, budynki i zwierzęta stoją pionowo w rzutowanych punktach; obiekty są sortowane po głębi (przedni narożnik podstawy).
- Domy i maszyny to bryły izometryczne (`render/art/isoBuilding.ts`: dwie ściany, dach czterospadowy, drzwi, okna, szyld). Dotyk trafia w cały sprite budynku, nie tylko w podstawę.

## Styl bajkowy

Plan: `docs/plan-grafika-bajkowa.md`.

- **Potok atlasu** (`render/art/palette.ts`): każda klatka dostaje miękką objętość (światło z lewej-góry, ciepły cień u dołu) i gruby kontur „atramentem” (#4a2e1a) liczony z sylwetki – cienie i poświaty konturu nie dostają. Ikony w HTML przechodzą przez ten sam potok.
- **Grafika**: akwarelowe kafle z kępkami trawy i kwiatkami-gwiazdkami, chatki z murem pruskim, łukowymi drzwiami, okrągłymi okienkami, falbanką dachu i kominem, puchate drzewa z owocami/kwiatami (choinki z gwiazdką zimą), zwierzęta chibi.
- **Magia na GPU** (`layers/AmbientLayer.ts`): świetliki nocą, motyle w dzień, płatki wiosną, liście jesienią, iskierki nad dojrzałymi plonami – zapętlone animacje SpriteGPULayer, CPU zmienia tylko krycie warstw.
- **Postprocess**: ColorMatrix (korekcja pory roku + daltonizacja), bloom, opcjonalny tilt-shift i winieta; przełączniki w ustawieniach.
- **Światło**: złoty poranek, różowo-fioletowy zmierzch, granatowa noc, ciepłe okna chatek.
- **Interfejs**: pergamin z ramką, cukierkowe przyciski z cieniem 3D, czcionka `ui-rounded` (SF Pro Rounded na iOS), tryb ciemny jako „nocna bajka”.

## Styl filmowy (w duchu animacji 3D)

Bez Blendera i prawdziwych modeli 3D – efekt „filmowy” robimy w kodzie, w tym samym potoku atlasu i na GPU:

- **Bryła sprite'ów** (`render/art/palette.ts`): poza ogólnym gradientem światła każda sylwetka dostaje miękki cień formy wzdłuż krawędzi od dołu-prawej i wąskie światło konturowe (rim light) od góry-lewej.
- **Aktorstwo (squash & stretch)**: roślina przy wzroście etapu przysiada, wyskakuje z rozciągnięciem i sprężyście ląduje; budynek spada na miejsce i spłaszcza się przy uderzeniu; zwierzęta oddychają, mrugają, podskakują z przygotowaniem i lądowaniem; mieszkańcy chodzą z podskokiem kroku i przechyłem.
- **Colour script**: korekcja kolorów zależna od pory roku (świeża wiosna, ciepłe lato, złota jesień, chłodna zima).
- **Bloom**: poświata liczona z jasności i zabarwiona na ciepło, mocniejsza o zmierzchu i nocą (latarnie, okna).
- **Głębia ostrości** (opcjonalna, w ustawieniach): tilt-shift – rozmyta góra i dół ekranu dają wrażenie makiety.

Ograniczenie: to wciąż grafika 2D rysowana proceduralnie. Prawdziwy wygląd z filmu (modele 3D, mapy normalnych pod oświetlenie Phasera) wymaga renderów z Blendera podmienionych przez `load.atlas` z tymi samymi nazwami klatek.

## Interfejs bajkowy

- **Wstążki zamiast okienek**: komunikaty to zielone/różowe/kremowe wstążki z wyciętymi końcami, w kolejce nad paskiem narzędzi (najwyżej dwie naraz).
- **Baner na ważne chwile**: awans poziomu, nowa pora roku i osiągnięcia pokazują złotą wstęgę z ikoną i iskierkami; kolejne awanse podmieniają treść zamiast się piętrzyć.
- **Pasek narzędzi**: nazwa tylko przy wybranym narzędziu, które wyskakuje w górę; przeszycie jak na płóciennej torbie, „Farma” jako drewniany szyld z czerwoną pieczęcią, gdy coś czeka.
- **Menu „Farma”**: malowane ikony (sakiewka, stragan, młotek, chatka, zwój, gwiazdka, koszyk, zębatka) zamiast emoji.
- **Podgląd grządki**: przytrzymanie palca na polu pokazuje dymek z czasem do zbioru, wodą, żyznością i przewidywaną jakością.
- **Pieczęcie przy krawędzi**: gdy gotowe plony, produkty zwierząt lub wyroby maszyn są poza kadrem, przy brzegu ekranu pojawia się pieczęć ze strzałką; dotknięcie przenosi tam kamerę.

## Wioska i mapa

- Mapa 64×64 (fragmenty mgły 8×8), farma 16×16 w środku. Zapis v3: migracja przesuwa budynki i odkryte fragmenty starej mapy 48×48.
- Na południe od farmy leży wioska: domy Ani, Bogdana, Celiny i Darka, ulica, latarnie. Mieszkańcy (`layers/VillagerLayer.ts`, czysto wizualni) chodzą po drzewie dróżek między domami, placem i polem, nocą wracają do domów. Dotknięcie postaci lub domu otwiera jej kartę w panelu wioski.

## Architektura

- **Data-driven:** uprawy, przedmioty, ryby, zwierzęta, budynki, receptury, mieszkańcy, umiejętności, zadania, osiągnięcia, festyny i pogoda są w `src/content/data/*.json`. `validateContent()` (test) pilnuje spójności odwołań, a test i18n – nazw w obu językach.
- **Deterministyczna symulacja:** stały krok 10 minut gry (`STEP_MS`), stan generatora losowego w zapisie, pogoda = funkcja (seed, dzień). Po powrocie gracza czas jest nadrabiany krok po kroku (limit 24 h rzeczywistych) z podsumowaniem na ekranie startowym.
- **Web Worker:** `sim/worker.ts` uruchamia `sim/engine.ts`; wątek główny (`sim/host.ts`) wysyła komendy i dostaje stan + zdarzenia. Bez Workera ten sam silnik działa w wątku głównym.
- **Event bus:** systemy emitują zdarzenia (`sim/events.ts`), na których działają zadania, osiągnięcia, samouczek, a w UI – efekty, dźwięk i komunikaty.
- **Czas:** 1 godzina gry = 1 minuta, doba = 24 min, sezon = 7 dni.

## Uruchomienie

```bash
npm install
npm run dev          # vite --host – adres "Network" otwórz w Safari na iPhonie (ta sama sieć Wi-Fi)
npm test             # testy Vitest (każdy system symulacji, zapis/migracje, i18n, gesty, kamera)
npm run build        # tsc (TS 7) + build produkcyjny do dist/
npm run preview      # podgląd builda z service workerem (--host)
```

**Narzędzie debugowania:** dodaj `?debug` do adresu (albo 5 razy dotknij numeru wersji w Ustawieniach) → Ustawienia → Narzędzia debugowania: tempo czasu 1–300×, +monety/XP, przeskok o 1/6/24 h, odkrycie mapy, dojrzewanie roślin, podgląd stanu.

## Wdrożenie

Vercel: projekt połączony z repozytorium (`vercel.json` – Vite, `dist`, nagłówki cache dla `sw.js` i zasobów). Każdy push na `main` wdraża się automatycznie.

Inne hostingi statyczne: `npm run build` i publikacja `dist/` (GitHub Pages: `BASE_PATH=/nazwa-repo/ npm run build`).

## Podmiana grafiki

Grafika jest rysowana kodem (`render/art/`) z opisów `art` w JSON-ach. Nazwy klatek atlasu (`crop_<id>_<0-4>`, `b_<budynek>`, `tree_<oak|pine>_<sezon>`, `animal_<id>_<0|1>`, `item_<id>`, `icon_*`, `p_*`, `fog`) i tileset 2×16 kafli 128 px (`Tile`) to kontrakt – prawdziwy atlas z tymi nazwami podmienia grafikę bez zmian w logice.

## Obejścia błędów Phasera

- **4.1.0:** `SpriteGPULayer` odwołuje się do globalnego `Phaser` → `render/phaserShim.ts` (naprawione w 4.2).
- **4.1 i 4.2.1:** `TilemapGPULayer` dolicza pozycję warstwy dwukrotnie → warstwa ziemi leży w (0,0).
- Animacje członków `SpriteGPULayer` z `loop: false` i easingiem innym niż Linear/Gravity liczą „repeats” z amplitudy → cząsteczki używają tylko Linear/Gravity.
