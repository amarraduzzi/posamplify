# Resto platform (werknaam)

Multi-tenant kassa en QR-bestelsysteem voor restaurants in Marokko. Eén codebase en één database voor alle restaurants, elk met een eigen menu, eigen branding en eigen gebruikers.

Dit is **fase 1: de fundering**. Zie het architectuurplan voor de volledige route.

## Wat er staat

| Onderdeel | Status |
|---|---|
| Databaseschema (restaurants, rollen, menu, orders, betalingen, kasbewegingen, dagafsluiting) | klaar |
| Beveiliging per restaurant (row level security, samengestelde foreign keys) | klaar, getest |
| Bestellen door gasten met prijzen van de server | klaar, getest |
| Fiscale documenten: doorlopende nummering, hash-keten, onveranderlijk, creditnota's | klaar, getest |
| Manager-PIN voor korting, annulering, creditnota en Z-rapport (met blokkade na 5 pogingen) | klaar, getest |
| Beheerfuncties: restaurant aanmaken, pauzeren, demo opruimen | klaar, getest |
| Klant-QR-app (`apps/menu`): FR/EN/AR met RTL, thema per restaurant, winkelmand, volgen van de bestelling | klaar, end-to-end getest |
| Import van het Dom's Café-menu uit de oude code | klaar (`supabase/seed.sql`) |
| Kassa-app, keukenscherm, menu-editor, QR-codes printen | volgende stap |

## Mappen

```
supabase/
  migrations/     het volledige databaseschema, in volgorde
  seed.sql        Dom's Café als eerste restaurant (gegenereerd, niet met de hand aanpassen)
  tests/          40 databasetests
apps/menu/        klant-QR-app (React + Vite)
packages/shared/  gedeelde types en hulpfuncties
scripts/
  test-db.sh              draait de databasetests op een wegwerp-Postgres
  import-domscafe.ts      zet data.ts van domscafe om naar seed.sql
  local/                  lokale database + API + browsertest, zonder Supabase-account
```

## Opzetten in Supabase (eenmalig)

1. Maak een nieuw project op supabase.com. Regio: **Frankfurt (eu-central-1)**. Kies het **Pro**-plan voor productie: het gratis plan zet projecten op pauze bij inactiviteit.
2. Installeer de Supabase CLI en koppel dit project:
   ```bash
   npm install
   npx supabase login
   npx supabase link --project-ref <jouw-project-ref>
   npx supabase db push
   ```
3. Maak jezelf platformbeheerder. Registreer eerst een account (Authentication > Users > Add user) en voer daarna in de SQL-editor uit:
   ```sql
   insert into public.platform_admins (user_id)
   select id from auth.users where email = 'jouw@email.ma';
   ```
4. Dom's Café als eerste restaurant laden (optioneel, voor testen):
   ```bash
   npx supabase db push --include-seed
   ```
   Let op: de seed bevat alleen wat in `data.ts` staat. Prijswijzigingen die in Firestore staan (`menuOverrides`) zitten er nog niet in. Die voegen we toe vlak voor de echte overstap (fase 3).

## Klant-app draaien en publiceren

```bash
cp apps/menu/.env.example apps/menu/.env.local   # vul URL en anon key in (Settings > API)
npm run dev:menu                                  # http://localhost:5173/doms-cafe/t/<tafelcode>
```

Publiceren op Cloudflare Pages:

- Build command: `npm run build -w @resto/menu`
- Output directory: `apps/menu/dist`
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, en `VITE_ROOT_DOMAIN` zodra je een eigen domein hebt.

Adressen:

- Met eigen domein (aanbevolen): `https://doms-cafe.jouwdomein.ma/t/<tafelcode>`. Zet een wildcard-DNS-record `*.jouwdomein.ma` naar Cloudflare Pages.
- Zonder eigen domein: `https://<project>.pages.dev/doms-cafe/t/<tafelcode>`.

De tafelcodes staan in de tabel `dining_tables` (kolom `qr_token`). De QR-code bevat altijd de code, nooit het tafelnummer, zodat niemand op een andere tafel kan bestellen door de link aan te passen.

## Testen

```bash
npm run test:db     # 40 databasetests op een wegwerp-Postgres 16+ (lokaal geïnstalleerd)
```

De tests bewijzen onder meer:

- elke tabel heeft RLS, gasten hebben geen enkel tabelrecht;
- gebruikers van restaurant A zien nul rijen van restaurant B, in elke tabel, en kunnen er niets schrijven;
- een rij van A kan nooit naar een rij van B verwijzen;
- prijzen die de browser meestuurt, worden genegeerd;
- afgesloten orders en fiscale documenten zijn bevroren, ook voor de database-superuser;
- de hash-keten detecteert een achteraf gewijzigd bedrag;
- een foute PIN wordt geteld, na 5 pogingen is de medewerker 5 minuten geblokkeerd.

Browsertest van de klant-app (lokaal, zonder Supabase-account):

```bash
bash scripts/local/db.sh start                 # Postgres met schema + Dom's-menu op :54322
node scripts/local/api.mjs &                   # nabootsing van de Supabase-API op :54321
VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_ANON_KEY=dev npm run dev:menu &
node scripts/local/e2e.mjs                     # bestelt als gast en controleert alles in de database
```

## Belangrijke ontwerpkeuzes

- **Bedragen in centimes** (gehele getallen), nooit kommagetallen.
- **Prijzen komen altijd uit de database.** De gast stuurt alleen wat hij wil (item, variant, aantal).
- **Elke bestelling heeft een `client_id`** die op het toestel wordt aangemaakt. Opnieuw proberen na een netwerkfout geeft nooit een dubbele bestelling, en straks werkt offline synchroniseren op dezelfde manier.
- **Een orderregel bewaart een kopie** van naam, prijs en btw. Een menuwijziging verandert nooit een oude bestelling.
- **Correcties na afrekenen gaan via een creditnota**, nooit via een wijziging.
- **Btw per regel**, prijzen inclusief btw, korting proportioneel verdeeld over de regels. Standaard 10 %, instelbaar per restaurant en per item.

## Bekende beperkingen (bewust, voor later)

- Gasten kunnen zonder captcha bestellen. De database begrenst het aantal (8 per tafel en 150 per restaurant per 10 minuten). Cloudflare Turnstile kan erbij zodra er misbruik is.
- Openingstijden worden opgeslagen, maar de klant-app sluit het bestellen buiten die tijden nog niet af.
- De Tailwind v4-CSS van de klant-app vraagt Safari 15.4+ of Chrome 99+. Voor de kassa (Windows 7, Chrome 109) moet de opmaak bewust compatibel blijven, zoals nu in domscafe.
