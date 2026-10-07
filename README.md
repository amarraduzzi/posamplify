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
| Kassa-app (`apps/pos`): tafels, bestellen, QR-bestellingen live, afrekenen, korting, annuleren, creditnota, X/Z-rapport, kasgeld, printen via printhost.exe | klaar, end-to-end getest |
| Beheer-app (`apps/admin`): menu-editor (3 talen, varianten, foto's), personeel met PIN, tafels en QR-codes printen, restaurantinstellingen, verkopen met CSV-export, platformbeheer (restaurants aanmaken, activeren, pauzeren) | klaar, end-to-end getest |
| Onboarding: restaurant maakt zelf een account, startwizard (menu-sjabloon, tafels, eigen PIN), kassa koppelen met eenmalige code, kassa's ontkoppelen | klaar, end-to-end getest |
| Offline kassa: bestellen, bonnen, afrekenen en pincode zonder internet, automatisch doorsturen bij herstel (`apps/pos/src/lib/outbox.ts`) | klaar, end-to-end getest |
| Kassa en beheer in het Arabisch (rechts naar links), taal per medewerker | klaar |
| Website met aanmelding op de hoofdpagina van het menudomein (`apps/menu/src/landing`) | klaar |
| Briefing voor de eigenaar: exacte dagcijfers + signalen (`owner_briefing`), AI-conseiller via Edge Function `briefing-ai` | klaar (AI na instellen sleutel) |
| Online abonnementsbetaling | later |

## Mappen

```
supabase/
  migrations/     het volledige databaseschema, in volgorde
  seed.sql        Dom's Café als eerste restaurant (gegenereerd, niet met de hand aanpassen)
  tests/          40 databasetests
apps/menu/        klant-QR-app (React + Vite, Tailwind v4)
apps/pos/         kassa (React + Vite, Tailwind v3: draait op Chrome 109 / Windows 7)
apps/admin/       beheer voor eigenaars en platformbeheer (React + Vite, Tailwind v3)
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

## Kassa publiceren (tweede Cloudflare Pages-project, zelfde repo)

- Build command: `npm run build -w @resto/pos`
- Output directory: `apps/pos/dist`
- Zelfde drie environment variables als de klant-app.

Per kassa-pc: log één keer in met het kassa-account van het restaurant (rol `device`). Medewerkers kiezen daarna hun naam en typen hun PIN. Printen gaat via printhost.exe (zie de domscafe-repo); printernamen per restaurant staan in `restaurants.pos_settings`, standaard `TICKET`, `BAR` en `CUISINE`.

## Beheer publiceren (derde Cloudflare Pages-project)

- Build command: `npm run build -w @resto/admin`
- Output directory: `apps/admin/dist`
- Variabelen: dezelfde drie, plus `VITE_MENU_URL` (adres van de klant-app, standaard `https://menu.amplifygrowthstudio.com`), nodig voor de QR-codes.

## Supabase-instellingen voor onboarding

- Authentication > Sign In / Providers > **Allow anonymous sign-ins**: aan (kassa's koppelen met een code).
- Authentication > Sign In / Providers > Email > **Confirm email**: uit zolang er geen eigen e-mailserver (SMTP) is ingesteld; het standaard e-mailadres van Supabase verstuurt maar een paar mails per uur.
- Beheer-app: optioneel `VITE_POS_URL` (adres van de kassa, standaard https://caisse.amplifygrowthstudio.com).

## Testen

```bash
npm run test:db     # 53 databasetests op een wegwerp-Postgres 16+ (lokaal geïnstalleerd)
```

Volledige lokale Supabase (database + echte Auth + PostgREST) voor de kassa, met een nep-printhost die tickets als tekst opslaat:

```bash
BIN=~/bin bash scripts/local/stack.sh start     # postgrest + auth binaries van GitHub releases in ~/bin
node scripts/local/setup-till.mjs               # kassa@doms.test / kassa-test-123, PIN Sara 1111, Karim 9999
node scripts/local/fake-printhost.mjs &
(cd apps/pos && VITE_SUPABASE_URL=http://localhost:54331 VITE_SUPABASE_ANON_KEY=$(cat ../../.localstack/anon.key) npx vite) &
node scripts/local/e2e-pos.mjs                  # volledige kassadag, van login tot Z-rapport
(cd apps/admin && VITE_SUPABASE_URL=http://localhost:54331 VITE_SUPABASE_ANON_KEY=$(cat ../../.localstack/anon.key) npx vite) &
node scripts/local/e2e-admin.mjs                # menu, personeel, tafels/QR, instellingen, platform
node scripts/local/e2e-onboarding.mjs           # nieuw restaurant: aanmelden, wizard, kassa koppelen, eerste verkoop
node scripts/local/e2e-offline.mjs              # internet valt weg: bestellen, bon, afrekenen, herladen, daarna alles gesynchroniseerd
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

## AI-conseiller activeren (eenmalig)

1. Supabase > Edge Functions > Deploy a new function > Via editor: naam `briefing-ai`, inhoud van `supabase/functions/briefing-ai/index.ts`.
2. Supabase > Edge Functions > Secrets: `GEMINI_API_KEY` (gratis sleutel via aistudio.google.com > Get API key) of `ANTHROPIC_API_KEY`. Optioneel `BRIEFING_MODEL`. Namen van personeel worden vervangen door labels voordat de cijfers naar de AI gaan.
Zonder sleutel toont het beheer "bientôt activé"; de rest van de briefing werkt altijd.

## Menu importeren (overstappen zonder overtypen)

Beheer > Menu > **Importer**. Twee routes, allebei eerst een controlescherm, daarna één klik (alles of niets) en elke import is ongedaan te maken:

- **Excel/CSV** (export van de oude kassa, of het downloadbare model). Kolommen worden herkend in FR/AR/EN (Désignation, Famille, Prix TTC, الاسم, السعر...), kostprijs/stock/btw-kolommen worden genegeerd, maten op aparte regels of in kolommen (S/M/L) worden varianten, categorie-titels als losse regels werken ook. Oud `.xls`: eerst opslaan als `.xlsx` of CSV.
- **Foto of PDF van de kaart** (max. 6 bestanden): Edge Function `menu-extract` laat Gemini de kaart lezen en vertalen. Deploy: Edge Functions > Deploy a new function > Via editor, naam `menu-extract`, inhoud van `supabase/functions/menu-extract/index.ts`, **Verify JWT uit**. Gebruikt dezelfde `GEMINI_API_KEY`.

Database: `import_menu`, `undo_menu_import`, tabel `menu_imports` (migratie `20260930000300_menu_import.sql`). Een gerecht dat al bestaat in dezelfde categorie wordt overgeslagen; verkochte gerechten worden bij ongedaan maken verborgen in plaats van gewist.
Tests: `supabase/tests/11_menu_import.test.mjs`, `node --test --experimental-strip-types scripts/menu-import-cases.test.ts`, `scripts/local/e2e-import.mjs`.

## Amplify Profit (fase 1)

Tweede product op hetzelfde platform (`restaurants.products`: `pos`, `profit` of beide). Beheer > **Marges** en **Ingrédients**:
ingrediënten met inkoopprijs/perte, fiches techniques per gerecht (en per maat), food cost %, marge, prijsadvies, en met Amplify POS ook de verkochte aantallen en winst.
**Remplir avec l'IA** (Edge Function `profit-ai`, Verify JWT uit, zelfde `GEMINI_API_KEY`) vult standaardrecepten met geschatte prijzen ("prix estimé" tot bevestigd).
Database: migratie `20261001000100_profit.sql` (`profit_dishes`, `apply_recipe_suggestions`). Tests: `supabase/tests/12_profit.test.mjs`, `scripts/local/e2e-profit.mjs`.
