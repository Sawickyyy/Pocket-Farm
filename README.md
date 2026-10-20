# Pocket Farm

Casualowa gra farmerska 2D (widok z góry) na iPhone'a: Safari 26 / iOS 26, PWA działające offline.
Pętla: **zaoraj → posiej → podlej → poczekaj → zbierz → sprzedaj → kup ulepszenia**.

Stos: TypeScript 7 (strict) · Phaser 4.1 (TilemapGPULayer + SpriteGPULayer) · Vite 8 · Vitest 5 · idb-keyval · vite-plugin-pwa (Workbox).

## Uruchomienie

```bash
npm install
npm run dev          # vite --host – adres "Network" otwórz w Safari na iPhonie (ta sama sieć Wi-Fi)
npm test             # testy logiki (Vitest)
npm run build        # sprawdzenie typów (tsc) + build produkcyjny do dist/
npm run preview      # podgląd builda (z service workerem) – też --host
npm run icons        # ponowne wygenerowanie ikon PWA do public/icons
```

> Service worker działa tylko w `preview`/produkcji i tylko przez HTTPS (lub `localhost`).
> Do testu PWA na iPhonie wdróż build na HTTPS (poniżej) albo użyj tunelu, np. `npx cloudflared tunnel --url http://localhost:4173`.

## Wdrożenie jako strona statyczna

`dist/` to zwykłe pliki statyczne – wystarczy dowolny hosting z HTTPS:

- **Netlify / Cloudflare Pages / Vercel**: komenda `npm run build`, katalog `dist`.
- **GitHub Pages** (podścieżka): `BASE_PATH=/nazwa-repo/ npm run build` i opublikuj `dist/`.

Na iPhonie: Safari → Udostępnij → „Do ekranu początkowego”. Po pierwszym uruchomieniu gra działa offline.

## Struktura

```
src/
  main.ts                 bootstrap: zapis, store, UI, Phaser, cykl życia strony, ekran startowy
  core/store.ts           reaktywny store (subscribe/select)
  game/content.ts         balans: uprawy, ulepszenia, siatka, ceny
  game/state.ts           model GameState + stan początkowy
  game/logic.ts           czysta logika (till/plant/water/harvest/sklep), wzrost ze znaczników czasu
  game/progression.ts     XP i poziomy
  game/controller.ts      intencje gracza → logika → store + zdarzenia (efekty, dźwięk, UI)
  save/saveManager.ts     IndexedDB (debounce 1 s) + kopia w localStorage, visibilitychange/pagehide
  save/migrations.ts      wersjonowanie, migracje, normalizacja zapisu
  save/codec.ts           eksport/import zapisu jako tekst z sumą kontrolną
  input/gestures.ts       rozpoznawanie tap / drag / pinch (bez DOM, testowalne)
  input/pointerInput.ts   Pointer Events → gesty → scena/kontroler
  render/FarmScene.ts     scena Phasera: TilemapGPULayer (ziemia), SpriteGPULayer (rośliny, ikony)
  render/ParticleLayer.ts cząsteczki na SpriteGPULayer (ruch liczony w shaderze)
  render/cameraModel.ts   matematyka kamery (fit, pan, zoom wokół punktu)
  render/proceduralArt.ts grafika zastępcza (Canvas 2D) – kontrakt nazw klatek atlasu
  render/phaserShim.ts    obejście błędu Phasera 4.1 (globalny `Phaser` w ESM)
  audio/sfx.ts            dźwięki syntezowane w Web Audio
  ui/*                    HUD, pasek narzędzi, sklep, menu, toasty (HTML + CSS)
  pwa/register.ts         rejestracja service workera z pytaniem o odświeżenie
tests/                    Vitest: logika, poziomy, store, zapis/migracje/eksport, gesty, kamera
```

## Podmiana grafiki na atlas

`render/proceduralArt.ts` definiuje nazwy klatek (`radish_0..3`, `carrot_0..3`, …, `icon_lock`, `icon_drop`,
`icon_ready`, `p_dirt`, `p_water`, …) i tileset 8×1 kafli 128 px (`Tile.*`). Aby użyć prawdziwych grafik,
w `FarmScene` dodaj `preload()` z `this.load.atlas('sprites', 'sprites.png', 'sprites.json')` oraz
`this.load.image('tiles', 'tiles.png')` – `createTextures()` pominie wtedy rysowanie, bo tekstury już istnieją.
SpriteGPULayer wymaga atlasu z jednego obrazka (bez multi-atlasu).

## Znane obejścia Phasera

- **4.1.0**: `SpriteGPULayer` odwołuje się do globalnego `Phaser` → `render/phaserShim.ts` (naprawione w 4.2).
- **4.1 i 4.2.1**: `TilemapGPULayer` dodaje pozycję warstwy dwukrotnie → warstwa leży w (0,0), a siatka pól
  jest przesunięta w świecie (`GRID_X/GRID_Y` w `FarmScene.ts`).
