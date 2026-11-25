# Status – olstad-digital-web

Sist oppdatert: 2026-11-25

## Road to Nordkapp: personvern og support (gren feat/road-to-nordkapp-pages, ikke merget, ikke publisert)
- Faste adresser: /<språk>/road-to-nordkapp/privacy og /<språk>/road-to-nordkapp/support (uten språk: mellomvaren sender til
  brukerens språk). 18 språk, arabisk RTL. Med i oversikten /<språk>/privacy. Ikke på forsiden eller i admin (appen har ingen `home`).
- Tekster: i18n/apps/road-to-nordkapp/<språk>.json, fra spillets utkast (docs/lansering/personvern.md). Spillets menynavn hentes fra
  spillets .po-filer: `npm run sync:road-to-nordkapp` → data/road-to-nordkapp-labels.json (`check` stopper når de avviker).
- Plassholdere i data/apps.json (`publisher`): [ORGANISASJONSNUMMER], [ADRESSE], [KONTAKT-E-POST]. Vises markert på sidene.
  **Må fylles inn før merge til main** (Vercel publiserer main).
- Venter på Marco: plassholderne, avvikene mellom dokumentene (se rapporten 25.11), og test i forhåndsvisningen (`npm run preview`).
