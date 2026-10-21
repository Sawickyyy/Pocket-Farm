# Plan: nowy interfejs w stylu Pixara

Cel: interfejs ma wyglądać jak wycięty z filmu animowanego. Elementy mają być pełne, miękkie i oświetlone jak przedmioty
z planu zdjęciowego (drewno, malowana ceramika, papier, płótno, złoto), poruszać się z charakterem (sprężystość,
przygotowanie, dobicie ruchu) i być spójne ze światem gry.

**Twarde zasady:**

1. **Zero fioletu.** Żaden kolor interfejsu ani grafiki nie może mieć odcienia z przedziału 240°–320° (fiolety, lawendy,
   purpury, wrzosy). Pilnuje tego test automatyczny (etap 1).
2. **Zero „Liquid Glass”.** Bez `backdrop-filter`, rozmytego szkła i przezroczystych tafli. Wszystkie powierzchnie są
   nieprzezroczyste i mają fizyczny materiał.
3. **Wszystko bajkowe, nic systemowego.** Bez emoji, bez domyślnych kontrolek przeglądarki, bez płaskich prostokątów.
   Każda ikona jest namalowana w kodzie tym samym pędzlem co świat gry.
4. **Bez obrazków z sieci i bez ciężkich bibliotek.** CSS, SVG i canvas. Gra działa offline, a paczka rośnie o mniej niż 60 KB.

---

## 1. Zasady Pixara przełożone na UI

| Zasada animacji | Jak w interfejsie |
| --- | --- |
| Squash & stretch | Przycisk przy wciśnięciu spłaszcza się (scaleY 0,9, scaleX 1,06), po puszczeniu odbija i lekko przeskakuje. |
| Anticipation (przygotowanie) | Panel przed wyjazdem w górę lekko przysiada w dół (4 px); moneta przed lotem do licznika przykuca. |
| Follow-through | Wstążki, flagi i zawieszki na szyldach dobujają się po zatrzymaniu (wahadło 2–3 wychylenia). |
| Slow in / slow out | Krzywe sprężynowe `linear()` zamiast liniowych; nic nie zaczyna się ani nie kończy gwałtownie. |
| Staging | W danej chwili jeden „bohater”: otwarty panel przyciemnia i lekko rozmywa świat ciepłą sepią (nie szkłem). |
| Appeal | Duże, proste, okrągłe kształty; grube krawędzie; czytelne sylwetki; rumieńce i oczy tam, gdzie pasuje (maskotka, puste stany). |
| Secondary action | Bezczynne elementy „żyją”: moneta co jakiś czas błyska, liść na szyldzie kołysze się, maskotka mruga. |
| Solid drawing | Każdy element ma światło z lewej-góry, cień własny od dołu-prawej, ciepły odblask od dołu i miękki cień kontaktowy na tle. |

---

## 2. Paleta (tokeny)

Paleta „słoneczne popołudnie na farmie”: ciepła, nasycona, ale nie krzykliwa. Kolor każdego tokena ma wersję
**jasną** (światło), **bazową** i **głęboką** (cień, krawędź), bo materiały 3D potrzebują trzech tonów.

| Rola | Jasny | Bazowy | Głęboki | Gdzie |
| --- | --- | --- | --- | --- |
| Krem (papier) | `#fffaf0` | `#fbefd6` | `#e6cfa4` | karty, panele, dymki |
| Drewno | `#e8b77a` | `#c98a4a` | `#8a5a2e` | ramy, szyldy, pasek narzędzi |
| Liść (akcja) | `#9be06e` | `#5fb544` | `#3a8a2c` | główne przyciski, sukces |
| Słońce (nagroda) | `#ffe58a` | `#ffc53d` | `#d98e0b` | monety, poziom, baner, gwiazdki |
| Niebo (informacja) | `#bfe8ff` | `#5cb8f0` | `#2f86c2` | woda, pogoda, linki |
| Terakota (uwaga) | `#ffb59a` | `#f0704f` | `#b8452c` | ostrzeżenia, usuwanie, pieczęcie |
| Malina (serca, rumieńce) | `#ffc2c8` | `#f2667a` | `#c23a52` | przyjaźń, ulubione |
| Atrament (tekst) | – | `#4a2e1a` | `#2e1a0c` | tekst, kontury |

**Tryb wieczorny** (ciemny motyw systemu) to „wieczór przy lampie”, a nie fioletowa noc:

- tło głębokie granatowo-morskie `#1d3a4a` → `#14293a` (odcień 200–210°, daleko od fioletu);
- powierzchnie ciepłe orzechowe `#3a2a1e` / `#4a3626`;
- akcent bursztynowy `#ffb84a`;
- tekst kremowy `#fff1d6`.

**Zakaz fioletu w grze**, nie tylko w UI. Do wymiany:

| Miejsce | Teraz | Nowe |
| --- | --- | --- |
| `styles.css` motyw ciemny | `#262250`, `#332d68`, `#8f7ad6`, `#c9bde8`, `rgb(36 32 72)` | paleta „wieczór przy lampie” |
| Pasek XP | gradient z `#b69cff` | słońce → miód → pomarańcz |
| Samouczek | `#3d3a8a`, `#2a2766`, `#17154a` | maskotka i dymek z papieru (sekcja 6.17) |
| Oświetlenie: zmierzch | `DUSK = [0xf2,0x9c,0xc0]` (róż-wrzos) | brzoskwiniowo-pomarańczowy `[0xff,0xa8,0x70]` |
| Oświetlenie: noc | `NIGHT = [0x52,0x5c,0xa8]` (niebiesko-fioletowa) | chłodny błękit morski `[0x4a,0x6a,0x9a]` |
| Winieta | `0x2a1a40` | ciepły brąz `0x3a2414` |
| Cieniowanie sprite'ów | `rgba(70,36,110,…)`, `rgba(120,60,90,…)` | chłodny błękitnoszary `rgba(40,70,100,…)` + ciepły brąz |
| Cienie obiektów | `#2a1a30`, `rgba(40,20,50,…)` | `#2a2010`, `rgba(50,35,20,…)` |
| Motyle | `#c9b6ff` | błękit `#9fd8ff` i brzoskwinia `#ffc89a` |

---

## 3. Materiały (przepisy CSS)

Każdy element interfejsu jest zbudowany z jednego z sześciu materiałów. Materiał to zestaw zmiennych CSS i klasa
`.m-*`: gradient, podświetlenie, cień własny, krawędź i cień kontaktowy. Bez obrazków, wszystko z warstw gradientów i cieni.

1. **Ceramika glazurowana** (przyciski, przełączniki, plakietki)
   - pionowy gradient jasny → bazowy;
   - biały połysk-elipsa w górnej 40% (`radial-gradient`);
   - wewnętrzny cień u dołu (głęboki ton);
   - „grubość” jako 0,3 rem cienia przesuniętego w dół w kolorze głębokim;
   - miękki cień kontaktowy na tle.
   - Przy wciśnięciu grubość maleje do 0,05 rem: przycisk fizycznie się zapada.
2. **Drewno** (ramy, pasek narzędzi, szyldy, nagłówki paneli)
   - słoje z `repeating-linear-gradient` w trzech odcieniach brązu z lekkim falowaniem (dwie nałożone warstwy pod różnym kątem);
   - jasna fazka u góry, ciemna u dołu;
   - „gwoździki” w rogach jako małe kółka z połyskiem.
3. **Papier / pergamin** (karty, dymki, listy, zawartość paneli)
   - kremowy z delikatnym ziarnem (SVG `feTurbulence` raz zakodowany jako `data:` URL, około 1 KB);
   - lekko nierówna krawędź (`border-radius` z różnymi promieniami);
   - cień jak kartka leżąca na stole.
4. **Płótno** (zakładki, wstążki, banery)
   - tkanina z drobną kratką (dwa `repeating-linear-gradient`);
   - przeszycie przerywaną linią;
   - końce wycięte w jaskółczy ogon.
5. **Złoto / mosiądz** (monety, ramka poziomu, gwiazdki jakości, pieczęcie nagród)
   - gradient stożkowy (`conic-gradient`) z dwoma odbłyskami;
   - mocny biały punkt połysku;
   - co kilka sekund przelatuje błysk (`@keyframes` z maską).
6. **Wosk** (pieczęcie liczników i powiadomień)
   - terakota lub malina z falistą krawędzią (SVG `clip-path`);
   - wytłoczony symbol;
   - połysk.

Cień kontaktowy jest zawsze ciepły (`rgba(74,46,26,…)`), nigdy szary ani fioletowy.

---

## 4. Typografia

- Krój: `ui-rounded` (SF Pro Rounded na iPhonie), działa offline i jest pełny, miękki i „pixarowy”.
- Tytuły i liczby: grubość 800–900; delikatny jasny cień u góry i ciemniejszy kontur 1 px w kolorze atramentu
  (`paint-order: stroke`), przez co litery wyglądają na wytłoczone.
- Liczby: `font-variant-numeric: tabular-nums`. Przy zmianie każda cyfra podskakuje osobno (licznik monet, poziom).
- Treść: 600, wysokość linii 1,4, rozmiar zależny od ustawienia systemu (sekcja 9).
- Hierarchia (rem, przy skali 1): baner 1,8 · tytuł panelu 1,35 · nagłówek karty 1,05 · treść 0,95 · podpis 0,8.

---

## 5. Ruch (specyfikacja animacji)

**Krzywe** (CSS `linear()` obsługiwane przez Safari 17.2+; zapasowo `cubic-bezier`):

| Nazwa | Przeznaczenie | Charakter |
| --- | --- | --- |
| `--spring-pop` | pojawianie się, wciśnięcia | szybki start, przeskok 8%, dwa małe dobicia |
| `--spring-soft` | panele, wjazdy | łagodny, przeskok 3% |
| `--anticipate` | wyjazdy, rzuty | cofnięcie 6% i wyjazd z przyspieszeniem |
| `--settle` | zawieszki, wstążki | wahadło wygaszane (3 wychylenia) |

**Czasy:** dotyk 90 ms (wciśnięcie) i 240 ms (powrót) · pojawienie 320–420 ms · panel 380 ms · baner 600 ms · bezczynność 3–6 s w pętli.

**Zasady:**

- Animujemy tylko `transform` i `opacity`, więc całość działa na GPU, a iPhone utrzyma 120 Hz.
- Każda interakcja ma odpowiedź w mniej niż 100 ms (wciśnięcie + dźwięk), nawet gdy wynik przychodzi z Workera później.
- Przy ograniczonym ruchu (systemowym lub z ustawień) zostają tylko krótkie przenikania (150 ms), bez podskoków.

---

## 6. Elementy: projekt każdego z nich

### 6.1 Ekran startowy

- Zamiast karty z emoji 🌱: scena-okładka książki. Drewniana tabliczka z wypalonym napisem „Pocket Farm” wisi na dwóch
  sznurkach i kołysze się (follow-through).
- Pod spodem maskotka Kiełek (6.18) macha listkiem, a w tle świat gry jest już widoczny i lekko rozmyty ciepłą sepią.
- Podsumowanie powrotu („Gdy Cię nie było…”) to kartka z notesu przypięta pinezką: ikonki plonów i monet, liczby podskakują po kolei.
- Przycisk „Graj” to duży ceramiczny zielony przycisk z pulsującym połyskiem; po dotknięciu tabliczka odjeżdża w górę
  z przygotowaniem, a kamera robi lekki najazd na farmę.
- Ładowanie: zamiast „…” kiełek rośnie z nasionka (3 klatki), a pasek postępu to grządka, którą „przekopuje” motyka.

### 6.2 Licznik monet

- Kapsuła z papieru w drewnianej ramce, a w niej trójwymiarowa złota moneta z wytłoczonym kłoskiem (canvas), która
  co 5 s obraca się i błyska.
- Zarobek: monety z świata lecą łukiem do licznika, licznik podskakuje (squash), cyfry przewijają się jak w liczydle
  i każda dobija osobno.
- Wydatek: krótkie „zapadnięcie” i terakotowy błysk liczby, bez czerwonego migania.

### 6.3 Poziom i doświadczenie

- Złota rozeta z liczbą poziomu (wytłoczona cyfra) zamiast zielonego kółka.
- Pasek XP to drewniane korytko, w które wlewa się ciepły miód (gradient słońce → miód → pomarańcz) z bąbelkami
  i połyskiem na powierzchni. Przy przyroście miód faluje.
- Punkty umiejętności: woskowa pieczęć z gwiazdką, przyklejona do rozety, delikatnie pulsuje.

### 6.4 Zegar, pora roku, pogoda

- Drewniany szyld zawieszony na łańcuszku pod paskiem górnym, kołysze się przy zmianie godziny.
- Ikony pogody namalowane w 3D (canvas): pucołowate słońce z promykami, chmurka z twarzą przy deszczu, płatek śniegu,
  „gorący” słoneczny dysk przy upale. Żadnych emoji (`WEATHER_ICON` do usunięcia).
- Pora roku: mały symbol na szyldzie (pąk, słonecznik, liść klonu, płatek śniegu) zamieniający się przy zmianie
  z obrotem karty.
- Festyn: szyld dostaje kolorową girlandę chorągiewek, które kołyszą się na wietrze.

### 6.5 Przycisk menu (ustawienia)

- Okrągła ceramiczna plakietka z namalowaną zębatką-kwiatkiem (jak w menu „Farma”). Przy dotknięciu obraca się o 45° ze sprężyną.

### 6.6 Pasek narzędzi

- Drewniana skrzynka z narzędziami widziana lekko z góry: deska z fazką, gwoździki w rogach, przegródki.
- Każde narzędzie leży w swojej przegródce jako trójwymiarowy przedmiot (malowany canvas z oświetleniem, nie płaskie SVG).
  Wybrane narzędzie wyskakuje z przegródki: unosi się, przechyla o −8°, rzuca cień na skrzynkę, a pod nim pojawia się
  płócienna metka z nazwą.
- Licznik nasion i nawozu: mała drewniana zawieszka z cyfrą wisząca na sznurku przy narzędziu, kołysze się przy zmianie.
- „Farma”: na końcu skrzynki stoi miniaturowa chatka; gdy coś czeka, z komina leci dymek, a na drzwiach wisi woskowa pieczęć z liczbą.

### 6.7 Panel (arkusz)

- Wysuwa się od dołu jak drewniana tablica ogłoszeń z przypiętą kartką papieru. Wjazd sprężynowy z przygotowaniem.
- Świat za panelem dostaje ciepłą sepię i przyciemnienie (filtr kamery ColorMatrix w Phaserze, nie rozmycie szkła).
- Panel można przeciągnąć palcem: w górę (pełny ekran), do połowy lub w dół (zamknięcie). Przy puszczeniu dobija sprężyną.
- Nagłówek to deska z wypalonym tytułem. Przycisk zamknięcia: ceramiczny guzik z namalowanym krzyżykiem z gałązek.
  Powrót: guzik ze strzałką-listkiem.
- Przewijana zawartość ma u góry i u dołu cień „zagięcia kartki”.

### 6.8 Zakładki

- Płócienne zakładki wystające z góry kartki jak w segregatorze, każda w innym kolorze palety, z ikonką.
- Wybrana zakładka jest wyższa i „zachodzi” na kartkę. Zmiana zakładki odwraca kartkę (przejście View Transitions,
  wspierane w Safari 18).

### 6.9 Karty (przedmioty, zamówienia, zadania)

- Kartka papieru lekko obrócona (losowo ±0,6°), przypięta spinaczem lub pinezką w kolorze palety.
- Miniatura w okrągłym drewnianym talerzyku. Cena na złotej metce zawieszonej na sznurku.
- Karta „gotowa” (np. zamówienie do oddania) ma złotą obwódkę i przelatujące iskierki; karta zablokowana jest szkicem
  ołówkiem (szary kontur, bez koloru) z kłódką z mosiądzu.
- Pusta lista: maskotka z krótkim tekstem („Spiżarnia czeka na pierwsze plony!”) zamiast suchego komunikatu.

### 6.10 Przyciski

| Rodzaj | Materiał | Kolor |
| --- | --- | --- |
| Główny (Kup, Oddaj, Graj) | ceramika | liść |
| Nagroda (Odbierz, Sprzedaj wszystko) | ceramika + złote iskierki | słońce |
| Drugorzędny (Anuluj) | drewno | jasne drewno |
| Niebezpieczny (Rozbierz) | ceramika | terakota |
| Ikonowy (zamknij, ±) | okrągła ceramika | krem |

Wszystkie: wciśnięcie = zapadnięcie + spłaszczenie, puszczenie = odbicie. Wyłączony: matowy, bez połysku i grubości,
z lekko spękaną glazurą (wzór), żeby było jasne, że nie działa. Kursor/dotyk nie powiększa.

### 6.11 Przełączniki, suwaki, wybór

- Przełącznik: drewniany suwak z ceramiczną gałką. Włączony: gałka przesuwa się na zielone pole z listkiem, wyłączony:
  na kremowe z kropelką. Przesuw ze sprężyną.
- Wybór segmentowy (język, ruch): rząd ceramicznych kafli; wybrany jest wciśnięty i zielony.
- Suwak skali interfejsu: rowek w desce i gałka-żołądź.
- Lista rozwijana (daltonizm) zastąpiona kafelkami z podglądem kolorów, bez systemowego `<select>`.

### 6.12 Menu „Farma”

- Rozkładana mapka farmy na papierze: osiem miejsc (stragan, targ, warsztat, wioska, tablica zadań, drzewko umiejętności,
  spiżarnia, skrzynka narzędzi) jako małe trójwymiarowe budyneczki i przedmioty na mapie.
- Dotknięcie: przedmiot podskakuje i panel „wjeżdża” z jego miejsca (View Transitions z punktu dotyku).
- Woskowe pieczęcie z liczbami przy miejscach, gdzie coś czeka.

### 6.13 Panele treści

| Panel | Projekt |
| --- | --- |
| Rynek | Drewniany stragan z markizą u góry; ceny na tabliczkach kredowych; trend ceny jako strzałka-listek (w górę zielona, w dół terakota). |
| Sklep nasion | Torebki nasion jak w prawdziwym sklepie ogrodniczym: papierowe saszetki z namalowaną rośliną i kolorowym paskiem pory roku. |
| Spiżarnia | Półki z drewna; przedmioty stoją na półkach z cieniem; jakość jako złota/srebrna gwiazdka-plakietka. |
| Budowanie | Katalog-szkicownik: budynek narysowany kredką, po wybraniu „koloruje się”; koszt na metce. |
| Wioska | Okienka domów mieszkańców; portrety w drewnianych ramkach z serduszkami jak koraliki na sznurku; zamówienia jako listy w kopertach z pieczęcią. |
| Prezent | Kosz prezentowy; reakcja mieszkańca jako duży portret z miną (zachwyt/uśmiech/obojętność). |
| Zadania i osiągnięcia | Tablica korkowa z przypiętymi kartkami; osiągnięcia jako odznaki-przypinki (zdobyte błyszczą, niezdobyte to szkice). |
| Umiejętności | Prawdziwe drzewko: pień i gałęzie z drewna, umiejętności jako owoce, które dojrzewają po odblokowaniu (z zielonych na złote). |
| Statystyki | Notes rolnika z odręcznymi kreskami i małymi wykresami słupkowymi z marchewek. |
| Ustawienia | Skrzynka z narzędziami ogrodnika; każda opcja to przełącznik z 6.11 z ikoną. |
| Eksport/import | Słoik z karteczką: kod zapisu jako karteczka do skopiowania, import jako wsypanie karteczki do słoika. |

### 6.14 Tryb budowania

- U góry drewniana belka z napisem i trzema ceramicznymi guzikami: zatwierdź (liść), przenieś/rozbierz (terakota),
  anuluj (drewno).
- Duch budynku półprzezroczysty z ciepłą obwódką. Pole poprawne: zielona kreda pod spodem, niepoprawne: terakotowe
  kreskowanie. Przy postawieniu budynek spada ze squashem (już jest w grze).

### 6.15 Komunikaty i baner

- Wstążki z płótna (już są) dostają tkaninę, przeszycie i follow-through końców przy pojawieniu.
- Baner: zamiast emoji ikona 3D z canvasu (gwiazda z buzią przy awansie, puchar, symbol pory roku) oraz konfetti
  z listków i płatków w kolorach palety.

### 6.16 Dymek podglądu i znaczniki przy krawędzi

- Dymek: papier z nierówną krawędzią i ogonkiem jak w komiksie. Paski jako korytka (woda: szklany słoiczek z wodą,
  żyzność: woreczek ziemi, wzrost: pnącze rosnące wzdłuż paska).
- Znaczniki: drewniane strzałki-drogowskazy z namalowaną ikoną, kołyszące się na palu.

### 6.17 Samouczek

- Zamiast granatowo-fioletowego okna: maskotka Kiełek wyskakuje zza krawędzi ekranu z dymkiem z papieru.
- Wskazuje listkiem cel, a obok celu pulsuje złota obwódka z iskierkami.
- „Dalej” i „Pomiń” jako małe guziki w dymku.

### 6.18 Maskotka „Kiełek”

- Mały pucołowaty kiełek z dwoma listkami, dużymi oczami i rumieńcami, rysowany w canvasie z cieniowaniem 3D.
- Siedem min (klatek): radość, zachęta, zdziwienie, smutek, sen, machanie, wskazywanie.
- Gdzie się pojawia:
  - ekran startowy i ładowanie;
  - samouczek;
  - puste stany;
  - błędy (np. uszkodzony kod zapisu: Kiełek drapie się po głowie);
  - podsumowanie powrotu;
  - festyny.

### 6.19 Okno potwierdzenia

- Kartka z listem na drewnianej podkładce, pytanie wielkimi literami, dwa przyciski (drewniany „Anuluj” i ceramiczny
  zielony „Tak”). Przy braku monet zielony przycisk jest matowy, a pod spodem terakotowa notka.

### 6.20 Łowienie ryb

- Pasek łowienia staje się taflą wody w drewnianej ramie (pomost): strefa trafienia to pływający liść lilii, znacznik
  to spławik (czerwono-biały, kołysze się), a nie emoji 🐟.
- Przycisk „Zatnij!” to duży ceramiczny przycisk z ikoną wędki; po trafieniu ryba wyskakuje łukiem z wody (squash przy
  złapaniu) i leci do spiżarni.

### 6.21 Napisy dźwięków (captions)

- Małe tabliczki z papieru przy dole ekranu, z ikonką (nuta, kurka, dzwonek), pojawiają się z lekkim podskokiem.

### 6.22 Pogoda na ekranie (nakładka)

- Krople deszczu jako krótkie, pucołowate kreski z połyskiem (nie cienkie linie), rozbryzgi przy dole ekranu.
- Śnieg jako płatki-gwiazdki różnej wielkości. Upał: lekkie falowanie powietrza przy górnej krawędzi (tylko przy włączonych efektach).

---

## 7. Ikony: malowane, trójwymiarowe

Jeden moduł `render/art/uiIcons.ts` rysuje wszystkie ikony interfejsu w canvasie z modelem oświetlenia:

- gradient sferyczny dla każdego kształtu (światło z lewej-góry);
- połysk-elipsa;
- cień własny przy krawędzi od dołu-prawej (istniejący potok `stylize`);
- ciepły kontur atramentu 3 px;
- cień kontaktowy pod ikoną.

**Lista** (zastępuje wszystkie emoji i płaskie SVG):

| Grupa | Ikony |
| --- | --- |
| Narzędzia | motyka, worek nasion (z ikoną wybranej rośliny), konewka, worek nawozu, sierp, wędka |
| Waluty i statystyki | moneta, rozeta poziomu, gwiazdka umiejętności, serce przyjaźni, XP-iskra |
| Pogoda i pory roku | słońce, chmurka, deszcz, upał, śnieg, pąk, słonecznik, liść klonu, płatek śniegu |
| Menu | 8 ikon menu „Farma” (już są, do dopracowania w nowym oświetleniu) |
| Sterowanie | zamknij, wstecz, plus, minus, kłódka, zatwierdź, obróć, rozbierz, informacja |
| Nagrody | puchar, odznaka, festyn (namiot), skrzynia skarbów |
| Maskotka | 7 min Kiełka |

Ikony są generowane raz przy starcie (jak atlas) i trzymane jako `data:` URL w pamięci podręcznej; HTML i Phaser
używają tych samych rysunków.

---

## 8. Dźwięk do każdego materiału

Istniejący syntezator dostaje po krótkim dźwięku na materiał:

- ceramika: miękkie „pyk”;
- drewno: stuk;
- papier: szelest;
- płótno: furknięcie;
- złoto: dzwoneczek;
- wosk: plaśnięcie pieczęci.

Interfejs brzmi jak przedmioty, z których jest zrobiony. Napisy dźwięków (captions) działają dla wszystkich.

---

## 9. Dostępność

- Kontrast tekstu co najmniej 4,5:1 (WCAG AA) w obu motywach; test automatyczny liczy kontrast par tokenów.
- Cele dotyku co najmniej 44×44 pt; przyciski ikonowe mają niewidoczny powiększony obszar dotyku.
- Rozmiar tekstu: rem skalowany ustawieniem gry **i** systemowym rozmiarem tekstu (`font: -apple-system-body` jako baza),
  układy sprawdzone przy 130% i 160%.
- Ograniczony ruch: tylko przenikania; bezczynne animacje wyłączone.
- Daltonizm: znaczenie nigdy nie tylko kolorem (ikona + kształt + tekst); obecny filtr daltonizmu działa dalej.
- VoiceOver: wszystkie ikony mają etykiety; plansza dostaje ukrytą listę pól z ich stanem.

---

## 10. Architektura techniczna

```
src/ui/theme/
  tokens.css        – paleta, krzywe ruchu, rozmiary (jedyne miejsce z kolorami)
  materials.css     – klasy .m-ceramic, .m-wood, .m-paper, .m-cloth, .m-gold, .m-wax
  motion.css        – @keyframes i klasy ruchu (.press, .pop-in, .settle, .idle-*)
  components/*.css  – przycisk, przełącznik, karta, panel, zakładki, pasek, licznik…
src/render/art/uiIcons.ts – ikony 3D w canvasie
src/render/art/mascot.ts  – Kiełek (7 min)
src/ui/components/        – małe fabryki DOM (button(), toggle(), card(), sheet…) z jednym źródłem wyglądu
```

- **Bez frameworków.** Dotychczasowe `h()` i panele zostają; zmienia się tylko warstwa wyglądu i fabryki komponentów.
- **Budżet wydajności:**
  - CSS poniżej 40 KB po kompresji;
  - najwyżej trzy cienie na element;
  - brak `backdrop-filter` i `filter: blur` w interfejsie;
  - animacje tylko na `transform` i `opacity`;
  - ikony generowane w czasie poniżej 80 ms przy starcie.
- **Testy:**
  - `theme.test.ts` – każdy kolor w CSS i w kodzie rysującym ma odcień spoza 240°–320° (strażnik „zero fioletu”), a pary tekst/tło mają kontrast co najmniej 4,5:1;
  - `uiIcons.test.ts` – każda ikona z listy istnieje i ma niepustą sylwetkę;
  - zrzuty e2e każdego panelu w obu motywach (Playwright), porównywane ręcznie na etapach.

---

## 11. Etapy wdrożenia

Każdy etap kończy się testami, zrzutami ekranu, commitem i scaleniem do `main`.

| Etap | Zakres | Efekt widoczny dla gracza |
| --- | --- | --- |
| 1. Fundament | tokeny, materiały, krzywe ruchu, strażnik fioletu, nowy motyw wieczorny, usunięcie fioletu z oświetlenia, winiety, cieni i motyli | Cieplejsza gra, zero fioletu, nowy ciemny motyw |
| 2. Ikony i maskotka | `uiIcons.ts`, `mascot.ts`, wymiana wszystkich emoji i płaskich SVG | Wszystko namalowane jednym pędzlem |
| 3. Górny pasek i skrzynka narzędzi | licznik monet, rozeta, korytko z miodem, szyld zegara, pasek narzędzi jako skrzynka | Nowy „kokpit” gry |
| 4. Panele | tablica z kartką, przeciąganie palcem, zakładki z płótna, karty, przyciski, przełączniki, sepia za panelem | Nowe wnętrza wszystkich menu |
| 5. Treści paneli | rynek, sklep, spiżarnia, budowanie, wioska, prezenty, zadania, drzewko umiejętności, statystyki, ustawienia, słoik zapisu | Każdy panel ma własny „plan zdjęciowy” |
| 6. Momenty | ekran startowy, samouczek z Kiełkiem, baner, komunikaty, potwierdzenie, łowienie, napisy, pogoda | Wejście do gry i ważne chwile jak z filmu |
| 7. Dźwięk i szlif | dźwięki materiałów, bezczynne animacje, dostępność (kontrast, rozmiar tekstu, VoiceOver), test na iPhonie | Spójność i wydajność |

---

## 12. Ryzyka

- **Wydajność na starszych iPhone'ach.** Wiele warstw gradientów i cieni kosztuje przy przewijaniu. Ograniczamy cienie,
  a efekty bezczynne wyłączamy przy niskim FPS (pomiar w pętli gry).
- **Czytelność kontra ozdobność.** Faktury (słoje, ziarno papieru) mają niski kontrast, żeby nie walczyły z tekstem;
  test kontrastu pilnuje tekstu.
- **Rozmiar paczki.** Wszystko proceduralne, więc paczka rośnie głównie o kod rysujący (szacunek: 40–60 KB).
- **Ograniczenie stylu „3D” w 2D.** Bez prawdziwych renderów 3D efekt opiera się na oświetleniu malowanym w canvasie i CSS.
  Ikony i maskotka są oddzielone kontraktem nazw, więc można je później podmienić na rendery z Blendera bez zmian w kodzie.
