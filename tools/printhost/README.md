# printhost: printen vanuit de kassa (Windows)

Klein Windows-programma (C, werkt vanaf Windows 7, geen beheerdersrechten nodig) waarmee de kassa in
Chrome zonder printvenster op bonprinters print. USB of netwerk (wifi/kabel): elke printer die in
Windows staat werkt. Geeft een netwerkprinter een vast IP-adres in de router.

- Klant: Kassa > Réglages du poste > Imprimantes > Télécharger, bestand openen, "C'est prêt", Vérifier,
  dan per bon een printer kiezen (bewaard op die pc). Ook te downloaden in Beheer > Paramètres > Caisse.
- Installeert zichzelf in %APPDATA%\Amplify, start mee met Windows (HKCU Run), vervangt de oude
  Dom's Café-printhost (Startup-map, alleen domscafe.pages.dev toegestaan).
- `printhost.exe --uninstall` stopt hem en haalt de automatische start weg.
- Alleen de Amplify-domeinen en localhost mogen printen; andere websites krijgen 403.
- Bouwen: `apt-get install gcc-mingw-w64-i686 && ./build.sh` (kopieert de exe naar apps/pos/public en apps/admin/public).
- Getest onder Wine: /ping, /printers, /print (RAW-bytes komen ongewijzigd aan), installeren, verwijderen.
  Op een echte Windows-pc met bonprinter nog te testen.
