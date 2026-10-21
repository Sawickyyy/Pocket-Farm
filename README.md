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
