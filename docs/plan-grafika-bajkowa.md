# Plan: bajkowa grafika (storybook)

Cel: ciepły, miękki styl jak z ilustrowanej książeczki – grube ciepłe kontury, pastelowe barwy,
objętość z miękkiego światła, magiczne drobiazgi (świetliki, motyle, iskierki), bez spadku płynności na iPhonie.
Grafika nadal powstaje w kodzie (Canvas 2D → atlas), więc wszystko jest parametryczne i łatwe do podmiany.

## Zasady stylu
- **Kontur „atramentem”**: ciepły, ciemnobrązowy (#4a2e1a), gruby, zaokrąglony – na każdym sprite'cie.
- **Objętość**: światło z lewej-góry (jasny połysk u góry, cieplejszy cień u dołu), bez twardych cieni.
- **Paleta**: pastelowa, ciepła, nasycona, ale miękka; jedna paleta w kodzie zamiast rozsianych kolorów.
- **Kształty**: zaokrąglone, lekko „pulchne”, bez ostrych krawędzi; zwierzęta w stylu chibi (duże oczy, rumieńce).
- **Atmosfera**: złota godzina, różowo-fioletowy zmierzch, granatowa noc z ciepłymi oknami i świetlikami.

## Etapy
1. **Paleta i potok atlasu** (`render/art/palette.ts`, `atlas.ts`)
   - wspólna paleta (trawy sezonowe, gleba, woda, kontur, światła),
   - automatyczne przejścia na każdej klatce atlasu: cieniowanie objętości (gradient „source-atop”)
     i kontur (stempel sylwetki w 8 kierunkach) – jednolity styl dla roślin, drzew, budynków, zwierząt, ikon.
2. **Kafle ziemi** – akwarelowa faktura (miękki szum), pulchne kępki trawy z konturem, kwiatki-gwiazdki,
   cieplejsza gleba z zaokrąglonymi bruzdami, turkusowa woda z falkami, ścieżka z kamyczkami.
3. **Budynki** – bajkowe chatki: mur pruski (belki szachulca), zaokrąglony dach z falbanką okapu, komin,
   okrągłe okienka świecące nocą (osobna klatka „noc” nie jest potrzebna – świeci światło sceny), kwiaty przy ścianie.
4. **Drzewa** – korony jak chmurki z warstw odcieni, owoce/kwiaty wiosną, choinki ze śniegiem zimą.
5. **Zwierzęta** – chibi: większa głowa, duże błyszczące oczy, rumieńce.
6. **Magia w świecie (GPU)** – nowa warstwa `AmbientLayer` na SpriteGPULayer z zapętlonymi animacjami
   (zero pracy CPU na klatkę): świetliki nocą, motyle w dzień, płatki wiosną, liście jesienią,
   iskierki nad dojrzałymi plonami.
7. **Postprocess kamery** (Phaser 4 Filters, jedna–dwie pełnoekranowe przebiegi):
   - ciepła korekcja kolorów (nasycenie, ciepły odcień) połączona z macierzą daltonizmu w **jeden** ColorMatrix,
   - delikatna winieta,
   - przełącznik „Efekty bajkowe” w ustawieniach (wyłączenie = oszczędzanie baterii).
8. **Oświetlenie** – nowa krzywa dnia: złoty poranek, różowo-fioletowy zmierzch, granatowa noc; tło sceny w pastelu.
9. **Interfejs HTML** – „książeczka”: kremowy pergamin, brązowe obramowania, zaokrąglona systemowa czcionka
   (`ui-rounded` = SF Pro Rounded na iOS, bez pobierania fontów – działa offline), cukierkowe przyciski z cieniem 3D,
   tryb ciemny jako „nocna bajka” (granat + złoto).
10. **Weryfikacja** – zrzuty dzień/zmierzch/noc i sezony, testy (paleta/macierze), build, brak błędów w konsoli,
    kontrola kosztu: liczba filtrów kamery ≤ 2, rozmiar atlasu ≤ 2048×4096.

## Ryzyka
- Filtry pełnoekranowe przy DPR 3 kosztują wypełnienie GPU → przełącznik w ustawieniach.
- Kontur na każdej klatce zwiększa czas budowy atlasu przy starcie → mierzyć (cel < 300 ms).
- Kontur może być przycięty na krawędzi klatki → klatki mają margines.
