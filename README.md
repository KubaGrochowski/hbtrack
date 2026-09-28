# Tygodnik

Tygodniowy tracker nawyków. Czysty HTML/CSS/JS, bez budowania i bez zależności.
Dane zapisują się w przeglądarce (`localStorage`), z możliwością eksportu i importu kopii JSON.

## Uruchomienie

Dowolny statyczny serwer w katalogu projektu, np.:

```bash
npx -y serve -l 5173 .
```

i otwórz http://localhost:5173. Można też otworzyć `index.html` bezpośrednio z dysku (wtedy bez trybu offline).

## Aplikacja na telefonie (PWA)

Tygodnik jest PWA: po wrzuceniu na hosting z HTTPS (np. GitHub Pages) można go zainstalować i używać bez internetu.

- **Android / Chrome / Edge:** menu ⋯ w aplikacji → „Zainstaluj aplikację” (albo ikona instalacji w pasku adresu).
- **iPhone / Safari:** przycisk Udostępnij → „Do ekranu początkowego”.

Bez logowania dane zostają na urządzeniu (każde urządzenie ma własne).

## Konto i synchronizacja (Supabase)

Menu ⋯ → „Zaloguj się”: e-mail + hasło („Załóż konto” przy pierwszym razie). Po zalogowaniu dane synchronizują się między urządzeniami (`js/cloud.js`, bez zewnętrznych bibliotek):

- każdy element (nawyk, wpis, notatka, kolejność) ma znacznik czasu zmiany, przy łączeniu wygrywa nowszy, usunięcia też się przenoszą;
- aplikacja dalej działa offline, zmiany wysyłają się po odzyskaniu połączenia;
- wylogowanie najpierw wysyła zmiany, potem czyści dane z urządzenia.

W Supabase: tabela `public.user_data (user_id, data jsonb, updated_at)` z RLS (każdy widzi tylko swój wiersz), w Authentication wyłączone „Confirm email”. W kodzie jest tylko klucz publiczny (`sb_publishable_…`); kluczy `service_role`/secret nie wolno tu dodawać. Po zmianach w plikach aplikacji podbij `VERSION` w `sw.js`, żeby stara pamięć podręczna została wyczyszczona.

## Obsługa

- **+ Nawyk** dodaje nawyk: liczbowy (cel dzienny, jednostka, krok +/−) albo tak/nie, z wyborem dni tygodnia.
- **⋯ przy nawyku** pokazuje ołówek (edycja) i × (usunięcie).
- Klik w **kółko** dnia: nawyk liczbowy otwiera edytor wartości, nawyk tak/nie przełącza zrobione ↔ puste.
- Zakładki **Tydzień / Kalendarz**. Kalendarz pokazuje miesiąc z % zrobionych nawyków w każdym dniu; klik w dzień otwiera jego tydzień.
- Płomyk z liczbą przy nazwie = seria zrobionych dni pod rząd.
- Uchwyt ⋮⋮ przy nazwie: przeciągnij, żeby zmienić kolejność.
- Telefon: przesuń wiersz w prawo = zrobione, w lewo = wyczyść.
- Pora dnia (Rano / Popołudnie / Wieczór) pokazuje się jako etykieta na kafelku nawyku.
- Notatka do dnia: na telefonie pole pod datą, na komputerze klik w dzień w nagłówku; w kalendarzu dzień z notatką ma kropkę.
- Na telefonie (szerokość do 680 px) widać jeden dzień: strzałki przełączają dni, przy każdym nawyku jest jedno kółko.
- Strzałki **‹ ›** obok nagłówka dni (oraz ← → na klawiaturze) przełączają tygodnie, w Kalendarzu miesiące. **Dziś** wraca do bieżącego. Nie da się cofnąć przed pierwszy tydzień aplikacji.
- **⋯** eksport kopii JSON, wczytanie kopii, wyczyszczenie danych.

## Struktura

- `index.html` – szkielet strony
- `css/styles.css` – motyw Onyks (czerń, zieleń)
- `js/app.js` – logika, zapis danych, renderowanie
- `manifest.webmanifest`, `sw.js` – PWA (instalacja, działanie offline)
- `icons/` – favicon i ikony aplikacji (`source.webp` to oryginał)

Format danych (`localStorage`, klucz `hbtrack.v1`):

```json
{
  "habits": [{ "id": "woda", "name": "Woda", "type": "num", "target": 2, "unit": "L", "step": 0.25, "days": [0,1,2,3,4,5,6], "created": "2026-09-21" }],
  "entries": { "woda": { "2026-09-25": 2 } }
}
```
