# Grochu's tracker

Tygodniowy tracker nawyków. Czysty HTML/CSS/JS, bez budowania i bez zależności.
Wymaga konta (e-mail + hasło); dane synchronizują się między urządzeniami przez Supabase i są też trzymane lokalnie, więc aplikacja działa offline.

Na żywo: https://kubagrochowski.github.io/hbtrack/

## Uruchomienie lokalnie

```bash
npx -y serve -l 5173 .
```

i otwórz http://localhost:5173.

## Aplikacja na telefonie (PWA)

- **Android / Chrome:** przeglądarka sama proponuje instalację (albo menu ⋮ → „Zainstaluj aplikację”).
- **iPhone:** Udostępnij → „Do ekranu początkowego”.

Po zmianach w plikach aplikacji podbij numer wersji: `VERSION` w `sw.js` oraz `?v=` przy plikach CSS/JS w `index.html` i w liście `SHELL` w `sw.js`.

## Konto i synchronizacja (Supabase)

Po wejściu jest ekran z zakładkami „Zaloguj się” / „Załóż konto”; panel pokazuje się dopiero po zalogowaniu. Prawy górny róg: na komputerze ⋯ (e-mail konta i „Wyloguj”), na telefonie ☰ (Tydzień, Kalendarz, Wyloguj się). Sesja zostaje na urządzeniu (wylogowanie tylko ręcznie albo gdy Supabase odrzuci sesję); formularz współpracuje z menedżerami haseł.

- Każdy element (nawyk, wpis, notatka, kolejność) ma znacznik czasu zmiany; przy łączeniu wygrywa nowszy, usunięcia też się przenoszą (`js/cloud.js`).
- Synchronizacja na żywo: zmiana wysyła się po 0,3 s, a inne urządzenia dostają ją od razu przez Supabase Realtime (WebSocket). Zapas: przy powrocie do aplikacji, po odzyskaniu internetu i co 20 s.
- Wylogowanie najpierw wysyła zmiany, potem czyści dane z urządzenia.

W Supabase: tabela `public.user_data (user_id, data jsonb, updated_at)` z RLS (każdy widzi tylko swój wiersz), dodana do publikacji `supabase_realtime`, w Authentication wyłączone „Confirm email”. W kodzie jest tylko klucz publiczny (`sb_publishable_…`); kluczy `service_role`/secret nie wolno tu dodawać.

## Obsługa

- Na telefonie nie da się przybliżać ani przesuwać ekranu w bok.
- Animacje: wejście listy po nawigacji, przesunięcie przy zmianie dnia/tygodnia, „pyknięcie” i rysowany ptaszek przy odhaczeniu, płynny licznik %, okienka i powiadomienia. Wyłączają się przy systemowym „ogranicz ruch”.
- **+ Nawyk** dodaje nawyk: tak/nie albo liczbowy (cel dzienny, jednostka, krok +/−), z wyborem dni i pory dnia.
- **⋯ przy nawyku** pokazuje ołówek (edycja) i × (usunięcie).
- Klik w **kółko** dnia: nawyk liczbowy otwiera edytor wartości, nawyk tak/nie przełącza zrobione ↔ puste.
- Zakładki **Tydzień / Kalendarz**. Kalendarz pokazuje % zrobionych nawyków w każdym dniu; klik w dzień otwiera jego tydzień.
- Płomyk z liczbą przy nazwie = seria zrobionych dni pod rząd.
- Uchwyt ⋮⋮ przy nazwie: przeciągnij, żeby zmienić kolejność.
- Telefon: jeden dzień na ekranie; przesuń wiersz w prawo = zrobione, w lewo = wyczyść.
- Notatka do dnia: na telefonie pole pod datą, na komputerze klik w dzień w nagłówku; w kalendarzu dzień z notatką ma kropkę.
- Strzałki **‹ ›** obok nagłówka dni (oraz ← →) przełączają tygodnie, w Kalendarzu miesiące. **Dziś** wraca do bieżącego.

## Struktura

- `index.html` – szkielet strony i ekran logowania
- `css/styles.css` – wygląd (czerń, zieleń)
- `js/app.js` – logika, zapis danych, renderowanie
- `js/cloud.js` – konto i synchronizacja z Supabase
- `manifest.webmanifest`, `sw.js` – PWA (instalacja, działanie offline)
- `icons/` – favicon i ikony aplikacji
