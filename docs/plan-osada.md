# Osada: city-builder na fundamencie farmy

Specyfikacja dla implementacji (symulacja, grafika, UI). Liczby są punktem wyjścia: można je stroić w
`src/content/data/settlement.json` i `buildings.json`, ale **nie** zmieniać kontraktów (typy, komendy, zdarzenia)
bez aktualizacji tego dokumentu.

## 0. Zasady

- **Deterministycznie.** Cała logika w Web Workerze, losowość wyłącznie przez `rand(s)` (stan generatora w zapisie).
  Żadnego `Math.random`/`Date.now` w `src/sim`.
- **Godzina i dzień.** Osada liczy się co pełną godzinę gry (`settlementHour`, krok symulacji = 10 min gry,
  więc co 6 kroków) i raz na dobę (`settlementDay`, po rozliczeniu farmy).
- **Offline.** Podczas nadrabiania (`ctx.offline === true`) nie losujemy katastrof (pożary, awarie, epidemie, kryzysy) –
  gra jest „przytulna”: gospodarka, przyjazdy, narodziny i relacje działają normalnie.
- **Jeden magazyn.** Ekwipunek gracza (`s.inventory`) jest magazynem osady: mieszkańcy jedzą z niego, warsztaty
  biorą z niego surowce i odkładają do niego wyroby, karawany kupują i sprzedają z niego.
- **Jedna waluta.** `s.coins` = skarbiec osady. Podatki, sprzedaż jedzenia i eksport wpływają, płace, utrzymanie
  i import wypływają. Gdy brakuje monet na płace – strajk (spadek szczęścia), nigdy ujemne saldo.
- **Wydajność.** ≤ 200 mieszkańców, ≤ 150 budynków osady; każda godzina gry ≤ 2 ms w Workerze.

## 1. Etapy rozwoju (tier)

| tier | id | populacja | odblokowuje (przykłady) |
| --- | --- | --- | --- |
| 0 | `camp` | 0–3 | namiot, chata, pole osady, studnia, ścieżka |
| 1 | `hamlet` | 4–15 | dom, magazyn, chata drwala, rybaczówka, plac budowy, droga, most |
| 2 | `village` | 16–50 | sklep, faktoria (karawany), tartak, warsztat, szkoła, plac, karczma, ratusz |
| 3 | `town` | 51–150 | kamienica, przychodnia, straż pożarna, posterunek, zajezdnia |
| 4 | `city` | 150+ | dwór, specjalizacja osady |

- `tierOf(population)` – bieżący etap; `settlement.peakTier` – najwyższy osiągnięty (budynki raz odblokowane
  zostają odblokowane). Awans → zdarzenie `tierUp` + wpis w kronice.
- Populacja = liczba mieszkańców (`settlement.residents.length`), gracz się nie wlicza.

## 2. Teren i budowanie

- `settlement.territory: number[]` – fragmenty mapy (8×8) należące do osady. Start: fragmenty farmy
  `[27, 28, 35, 36]` (= strefa `FARM`). Wioska Stara Wieś (fragmenty 43, 44) nie jest nasza.
- **Kupno terenu** `buyTerritory{chunk}`: fragment odkryty (`world.revealed`), sąsiadujący z terenem, nie wioska;
  koszt `300 × 1,5^kupione` monet; limit liczby fragmentów wg peakTier: `[4, 6, 9, 14, 24]`.
- **Gdzie wolno budować** (`canPlace`): każdy kafel w terenie osady, nie na polu uprawnym gracza, nie zajęty,
  bez drzewa, biom ≠ woda (wyjątek: `terrain: "water"` – tylko na wodzie, np. most), biom ≠ wioska.
  Wymagania terenu: `terrain: "shore"` – woda w odległości ≤ 2 kafli od obrysu; `terrain: "forest"` – las
  w odległości ≤ 4. Błędy: `outside-farm` (poza terenem), `blocked`, `terrain`, `tier-too-low`.
- **Wygląd**: `place{building, x, y, style?}` – budynki z `styles > 1` mają warianty wyglądu (0..styles-1);
  `restyle{uid, style}` zmienia wygląd postawionego domu za darmo.
- **Materiały**: `materials` z JSON są pobierane z magazynu przy postawieniu (`missing-items`, gdy brakuje).
- **Plac budowy**: budynki z `buildHours > 0` powstają jako budowa: `sites[uid].built` 0→1.
  Postęp na godzinę: `(1 + 0,5 × budowlańcy_pracujący) / buildHours` (budowlańcy z placów budowy, w godzinach
  pracy 7–17; poza nimi tempo bazowe ×0,5). Dopóki `built < 1`, budynek nie działa i nie ma mieszkańców.
  Ukończenie → zdarzenie `constructed`.
- Usunięcie domu/miejsca pracy: mieszkańcy tracą dom/pracę (zostają bezdomni/bezrobotni), zwrot 50% kosztu.

## 3. Drogi i dojazd

- Kafle drogi: obiekty `kind: "path"` (ścieżka, droga) i `kind: "bridge"` (most) + drogi wioski (`world.road`).
- **Dostęp budynku**: kafel drogi przylega (4-sąsiedztwo) do obrysu budynku.
- **Sieć**: spójne składowe kafli drogi (BFS, 4-sąsiedztwo).
- **Dojazd** dom → praca: obie budowle mają dostęp do tej samej składowej **albo** odległość środków
  (Manhattan) ≤ 6 kafli (≤ 12 z zajezdnią). Bez dojazdu mieszkaniec nie dostanie tej pracy.
- `findPath(s, c, world, from, to)` – najkrótsza trasa po kaflach drogi (A*/BFS) dla grafiki chodzących
  mieszkańców; zwraca listę kafli albo `null`.
- Droga kamienna (`road`) daje +25% prędkości chodu w grafice (bez wpływu na symulację).

## 4. Mieszkańcy, rodziny, napływ

```ts
Resident { id, name, family, child, bornDay, home: uid|null, job: uid|null,
           needs: {food, housing, work, safety, fun}, happiness, sadDays, homelessDays, arrivedDay, look }
```

- **Napływ** (codziennie o 9:00, `population.hour`): jeśli są wolne miejsca w ukończonych, nieuszkodzonych domach,
  średnie szczęście ≥ 0,45 (albo osada pusta) i w magazynie jest jedzenie na ≥ 1 dzień dla obecnych mieszkańców
  (pusta osada: bez warunku jedzenia), przyjeżdża do `1 + (szczęście > 0,7) + floor(peakTier / 2)` rodzin.
  Rodzina: 1–2 dorosłych + 0–2 dzieci, liczebność ≤ największego wolnego miejsca w jednym domu
  (rodzina mieszka razem). Imiona z `settlement.json` (`names.given` + `names.family`), wylosowane `rand`.
  Zdarzenie `arrived{family, count, home, at}`.
- **Wyjazd** (codziennie): dorosły z `sadDays ≥ 3` (szczęście < 0,25 przez kolejne doby) albo
  `homelessDays ≥ 2` wyjeżdża razem z dziećmi z rodziny; zdarzenie `left{count, reason}`.
- **Dzieci** dorastają po `childDays = 10` dniach (`grewUp`). Dorosły może pracować.
- **Para przybyszów**: rodzina z dwojgiem dorosłych przyjeżdża jako małżeństwo (relacja `partner`).
- **Narodziny**: para (`partner`) w jednym domu z wolnym miejscem: szansa 0,06/dzień → dziecko (`born`).
- **Bezdomni**: gdy dom zniknie lub zostanie uszkodzony, próbujemy przenieść rodzinę do wolnego domu (codziennie).

## 5. Zawody i praca

| zawód | gdzie | płaca/dzień |
| --- | --- | --- |
| `farmer` rolnik | pole osady, młyn, mleczarnia | 8 |
| `baker` piekarz | piekarnia, przetwórnia | 10 |
| `lumberjack` drwal | chata drwala | 8 |
| `fisher` rybak | rybaczówka | 8 |
| `merchant` handlarz | sklep, faktoria, karczma | 12 |
| `builder` budowlaniec | plac budowy | 10 |
| `craftsman` rzemieślnik | tartak, warsztat, tkalnia | 12 |
| `teacher` nauczyciel | szkoła | 14 |
| `medic` medyk | przychodnia | 16 |
| `firefighter` strażak | straż pożarna | 12 |
| `guard` strażnik | posterunek | 12 |

- `jobs.assign` (co godzinę): bezrobotni dorośli dostają wolne etaty w działających budynkach, do których mają
  dojazd; najbliższy pierwszy; przydziały są stabilne (nikt nie traci pracy bez powodu). Budynek przestaje działać
  (zniszczony, w budowie, usunięty) → jego pracownicy tracą pracę.
- **Wydajność pracownika** = `(0,5 + szczęście) × (1,1 jeśli w magazynie są narzędzia) × specjalizacja ×
  (1,1 z zajezdnią) × modyfikatory wydarzeń`. Praca tylko w godzinach 7–17.
- **Usługi działają w proporcji obsady**: `obsada = pracujący / etaty`.

## 6. Produkcja i łańcuchy dostaw

- Budynek z `production {inputs, output, hours}`: co godzinę pracy `progress += Σ wydajność / hours`; przy
  `progress ≥ 1` zużywa wejścia z magazynu i dodaje wyjście (jeśli brak wejść – czeka; jeśli magazyn pełny – czeka).
- `seasonal` (pole osady): wyjście zależy od pory roku, zima = przestój.
- `"@fish"` (rybaczówka): losowa ryba dostępna w danej porze roku/pogodzie.
- **Maszyny gracza z obsadą** (`jobs` + `autoRecipes` na młynie, piekarni, mleczarni, przetwórni, tkalni): pracownicy
  sami wykonują pierwszą wykonalną recepturę z listy, z prędkością `0,4 + 0,3 × pracujący` (2 osoby ≈ tempo gracza),
  z magazynu do magazynu (niezależnie od ręcznej kolejki gracza).
- Łańcuch: pole osady → pszenica → młyn → mąka → piekarnia → chleb → sklep (mieszkańcy kupują).
- **Magazyn**: pojemność `300 + Σ storage` (magazyny +300, ratusz +100); liczy się suma sztuk w ekwipunku.
  Przy pełnym magazynie produkcja osady staje (zbiory gracza nie).

## 7. Potrzeby i szczęście

Co godzinę każda potrzeba dąży do celu: `need += (cel − need) × 0,25`.

- **Jedzenie**: posiłki o 7:00 i 18:00, 1 pkt odżywczy na dorosłego, 0,5 na dziecko. Mieszkańcy jedzą najpierw
  najtańsze jedzenie (cena/odżywczość rosnąco), z pominięciem przedmiotów zarezerwowanych (`settlement.reserved`).
  Cel = odsetek najedzonych posiłków z ostatniej doby (+0,05 za ≥ 3 różne potrawy).
- **Mieszkanie**: komfort domu (namiot 0,35 … dwór 1,0) + 0,1 w zasięgu studni (max 1); bezdomny = 0.
- **Praca**: dorosły zatrudniony = 1, bezrobotny = 0,3; dziecko: 1 w zasięgu szkoły, inaczej 0,6.
- **Bezpieczeństwo**: `0,35 + 0,3·policja + 0,15·straż + 0,1·przychodnia + 0,1·światło` (pokrycie w domu);
  −0,3 podczas pożaru w promieniu 6.
- **Rozrywka**: `0,3 + 0,5·rozrywka(plac/karczma) + min(0,2, 0,05·dekoracje w promieniu 3)` + 0,15 podczas festynu.
- **Szczęście** (dążenie jak wyżej): `Σ waga·potrzeba − podatek·1,2 + relacje + modyfikatory`, przycięte do 0..1.
  Wagi: jedzenie 0,3, mieszkanie 0,2, praca 0,2, bezpieczeństwo 0,15, rozrywka 0,15.
  Relacje: +0,03 za przyjaciela (max +0,09), +0,05 partner, −0,05 za konflikt.
- **Pokrycie usług**: mapa 64×64 dla rodzaju usługi (`police`, `fire`, `clinic`, `school`, `fun`, `water`, `light`,
  `market`), wartość = max po budynkach `value × obsada` w promieniu (odległość euklidesowa od środka).

## 8. Budżet osady

Rozliczenie w `settlement.budget[0]` (bieżący dzień; przy nowym dniu przesuwamy, trzymamy 7 dni):
`{day, taxes, sales, exports, wages, upkeep, imports, investments}`.

- **Płace** (18:00): każdy zatrudniony dostaje płacę zawodu. Gdy brakuje monet – wypłacamy, ile się da,
  zdarzenie `unpaid{missing}`, wszystkim pracownikom szczęście −0,15.
- **Podatki** (nowy dzień): każdy dorosły płaci `stawka × (płaca + 10)` (bezrobotny: `stawka × 10`).
  Stawka `taxRate` 0..0,3 (domyślnie 0,1), komenda `setTax{rate}`.
- **Sprzedaż jedzenia**: posiłek mieszkańca w zasięgu działającego sklepu przynosi `4 monety × pkt odżywczy`.
- **Utrzymanie** (nowy dzień): suma `upkeep` ukończonych budynków.
- **Inwestycje**: koszty budowy budynków osady, decyzje rady, kupno terenu.
- Zdarzenie `budget{day, net}` po rozliczeniu dnia.

## 9. Infrastruktura i usługi

| budynek | usługa | promień | uwagi |
| --- | --- | --- | --- |
| studnia | `water` | 6 | +komfort, gaszenie pożarów (−50% obrażeń) |
| latarnia | `light` | 5 | bezpieczeństwo |
| magazyn | `storage` | – | +300 pojemności |
| plac | `fun` 0,6 | 8 | rozrywka |
| karczma | `fun` 0,8 | 7 | etat handlarza |
| most | – | – | droga na wodzie |
| szkoła | `school` | 10 | dzieci: potrzeba pracy, +5% wydajności dorosłych w zasięgu |
| przychodnia | `clinic` | 10 | bezpieczeństwo, epidemie zwierząt (leczy w 1 dzień), robi lekarstwa z ziół |
| straż pożarna | `fire` | 11 | szansa pożaru −70%, gasi w ≤ 1 h |
| posterunek | `police` | 11 | bezpieczeństwo, konflikty −50% |
| sklep | `market` | 9 | sprzedaż jedzenia |
| faktoria | `trade` | – | karawany |
| ratusz | `hall` | – | +100 magazynu, rada: zniżka 10%, wymagany do specjalizacji |
| zajezdnia | `transport` | – | dojazd bez dróg do 12 kafli, +10% wydajności |
| plac budowy | `build` | – | budowlańcy: budowa i naprawy |

## 10. Wydarzenia losowe (`events.newDay` + `events.hour`)

Losowane raz na dobę (nie offline, nie przed 3. dniem osady, max 1 katastrofa naraz):

- **Pożar** (szansa `0,03 × min(1, budynki/10) × (1 − 0,7·pokrycie straży)` na wylosowanym budynku osady):
  co godzinę `damage += 0,15 × (1 − 0,8·straż) × (studnia ? 0,5 : 1)`; gaśnie po 4 h albo w 1 h przy straży.
  `damage ≥ 0,5` → budynek uszkodzony (nie działa, mieszkańcy bezdomni). Zdarzenia `fire`, `fireOut`.
- **Awaria** (0,04, budynek z produkcją/maszyna z obsadą): `broken = true` do naprawy. Budowlańcy naprawiają
  w 3 h pracy; komenda `repair{uid}` naprawia od razu za 20% kosztu budynku (min 20). Zdarzenia `breakdown`, `repaired`.
- **Epidemia zwierząt** (0,03, gdy ≥ 2 zwierzęta): zwierzęta jednego budynku chorują 3 dni (nie produkują),
  1 dzień przy pokryciu przychodni; komenda `treatAnimals{home}` (1 lekarstwo) leczy od razu.
  Zdarzenia `epidemic`, `epidemicOver`. Hak: `animalHomeSick(ctx, uid)` w `updateAnimals`.
- **Kryzys gospodarczy** (0,02, po 7. dniu): 3 dni cen ×0,7 na rynku i u karawan. Hak: `priceMult(ctx)` w rynku.
- **Dobre wydarzenia** (0,05): festyn wędrownych grajków (rozrywka +0,15 na 2 dni), urodzaj (produkcja ×1,25 na 2 dni),
  bogata karawana (następna karawana płaci ×1,3).
- Uszkodzenia naprawiają budowlańcy (postęp `0,1/h × obsada`) albo `repair{uid}`.
- Każde wydarzenie trafia do kroniki (`chronicle`, max 40 wpisów).

## 11. Relacje społeczne (`social.newDay`)

`Relation {a, b, kind: 'friend'|'love'|'partner'|'conflict', v}` (a < b, max 6 relacji na osobę).

- Przyjaźń: współpracownicy lub sąsiedzi (domy ≤ 4 kafle) – szansa 0,08/dzień `v += 0,2` (relacja `friend`).
- Miłość: przyjaciele z `v ≥ 0,6`, dorośli, oboje bez partnera, z różnych rodzin – szansa 0,04 → `love`;
  `love` z `v ≥ 1` po kolejnych dniach (+0,15/dzień) → ślub (`partner`): wspólna rodzina, przeprowadzka do domu
  z miejscem (jeśli jest). Zdarzenie `relation`.
- Konflikty: sąsiedzi o szczęściu < 0,35 – szansa 0,1 (×0,5 przy posterunku) → `conflict` (`v` rośnie, gaśnie
  −0,1/dzień przy dobrym szczęściu). Każdy konflikt −0,05 szczęścia.

## 12. Handel z innymi osadami (`trade`)

- Karawany przyjeżdżają tylko, gdy działa faktoria. Odstęp: tier 2 co 3 dni, tier 3 co 2, tier 4 codziennie.
  Przyjazd o 10:00, odjazd o 18:00.
- Partnerzy w `settlement.json` (`partners`): Stara Wieś, Nadrzecze, Górki, Port – każdy z listą kupowanych
  i sprzedawanych towarów. Oferty: 3–4 towary kupowane (cena bazowa × 1,1–1,5, limit ilości),
  2–3 sprzedawane (× 1,2–1,6).
- `caravanSell{key, qty}`, `caravanBuy{item, qty}` (`no-caravan`, `no-stock`, `no-coins`).
- Auto-eksport: przedmioty z `settlement.autoExport` są sprzedawane przy przyjeździe (zostaje rezerwa 5 szt.),
  `toggleExport{item}`.
- Zdarzenia `caravan{from}`, `caravanLeft{from}`, `traded{item, qty, coins, dir}`.

## 13. Rada osady (`council`)

- Od tier 1, codziennie do 3 otwartych propozycji (ważnych 3 dni). Szablony w `settlement.json` (`proposals`)
  z warunkiem (np. brak studni, głód, brak szkoły przy ≥ 3 dzieciach, wysokie podatki, epidemia…).
- Rodzaje: `build` (zatwierdzenie = bon −40% na budynek przez 5 dni, mieszkańcy się dorzucają),
  `policy` (np. obniżka podatków o 0,05), `event` (festyn: koszt teraz, rozrywka +0,15 na 2 dni),
  `grant` (dotacja: koszt teraz, np. +5 narzędzi).
- `decideProposal{id, approve}`: zatwierdzenie +0,05 szczęścia popierającym (1 dzień), odrzucenie −0,05.
  Zdarzenia `proposal`, `decided`.

## 14. Specjalizacja (tier 4)

`specialize{id}` raz na grę (wymaga ratusza): `agri` (+25% produkcji żywności), `trade` (karawany codziennie,
ceny ×1,25), `craft` (+25% tartak/warsztat/tkalnia, narzędzia dają +20%).

## 15. Grafika i interfejs (skrót)

- Budynki osady z wariantami wyglądu (kolory dachu/ścian), budowa = rusztowanie, uszkodzenie = osmalenie + dym,
  pożar = płomienie (cząsteczki), awaria = ikonka klucza.
- Mieszkańcy chodzą po drogach gracza (dom → praca rano, praca → dom wieczorem, plac w wolnym czasie);
  limit widocznych postaci 40; strój wg zawodu.
- Karawana: wóz jedzie od krawędzi mapy do faktorii.
- Teren: obrys terenu osady, w trybie terenu ceny fragmentów do kupienia.
- Panel „Osada” (zakładki: przegląd, mieszkańcy, budżet, rada, handel, kronika), katalog budowy z kategoriami
  (domy, drogi, praca, infrastruktura, usługi, farma, dekoracje), wybór wyglądu domu, panel budynku osady
  (mieszkańcy/pracownicy, stan, naprawa, zmiana wyglądu), licznik mieszkańców z buźką szczęścia w górnym pasku.
