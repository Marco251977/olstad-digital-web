# Status – olstad-digital-web

Sist oppdatert: 2026-11-25

## Road to Nordkapp: personvern og support (gren feat/road-to-nordkapp-pages, ikke merget, ikke publisert)
- Faste adresser: /<språk>/road-to-nordkapp/privacy og /<språk>/road-to-nordkapp/support (uten språk: mellomvaren sender til
  brukerens språk). 18 språk, arabisk RTL. Med i oversikten /<språk>/privacy. Ikke på forsiden eller i admin (appen har ingen `home`).
- Tekster: i18n/apps/road-to-nordkapp/<språk>.json, fra spillets utkast (docs/lansering/personvern.md). Spillets menynavn hentes fra
  spillets .po-filer: `npm run sync:road-to-nordkapp` → data/road-to-nordkapp-labels.json (`check` stopper når de avviker).
- Ansvarlig «Nordic Digital Apps AS (Olstad Digital)» (data/apps.json `publisher`); org.nr. og adresse fra data/company.json
  (som Saldo Pocket og bunnteksten); e-post kontakt@nordicdigitalapp.com (data/apps.json `email`, også i bunnteksten på spillets
  sider). Saldo Pocket og resten av nettsiden bruker fortsatt kontakt@nordicdigitalapp.no (data/company.json).
- Runde 2 (Marco 25.11): poeng og beste tider i stedet for mynter, spillets egen ID (rtn_), hva RevenueCat bruker teknisk info til,
  «ingen analyse av hvordan du spiller», samme innhold på alle 18 språk.
- Venter på Marco: test i forhåndsvisningen (`npm run preview`) og ja før merge. Ingen push, merge eller publisering før det.
