// Writes the apps' public pages (privacy, deletion, support, and the overview «Privacy – our apps»)
// for every language, the front page with the company details, and the language middleware.
// One source for each thing:
// - company details: data/company.json (the front page, every footer and every legal page read it),
// - apps: data/apps.json (an app without a website of its own = a slug and its language files),
// - texts: i18n/common/<lang>.json (the shared template) and i18n/apps/<slug>/<lang>.json,
// - languages: app-core (the same 18 as the apps, with their own names and right-to-left).
// The pages are static files committed to the repo; Vercel only serves them.
//   node scripts/build-pages.mjs          write the files
//   node scripts/build-pages.mjs --check  stop (exit 1) if a file on disk is not what would be written
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CORE_LANGUAGES, FALLBACK_LANGUAGE } from 'app-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const company = read('data/company.json');
// Prompt 129 (Saldo Pocket): the privacy facts – retention numbers and the providers' terms – written by the app's
// scripts/privacy-sync.mjs from its one source (src/shared/privacy-facts.ts, privacy-recipients.ts); never edited here.
const privacyFacts = read('data/privacy-facts.json');
const { apps } = read('data/apps.json');
const LANGS = CORE_LANGUAGES.map((l) => l.code);
const ORIGIN = `https://${company.domain}`;
const PAGES = ['privacy', 'delete-account', 'support'];

// --- texts ---

const texts = (dir, lang) => read(`${dir}/${lang}.json`);
const common = Object.fromEntries(LANGS.map((l) => [l, texts('i18n/common', l)]));
const appTexts = Object.fromEntries(apps.filter((a) => a.slug).map((a) => [a.slug, Object.fromEntries(LANGS.map((l) => [l, texts(`i18n/apps/${a.slug}`, l)]))]));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Fills {{name}} with values (escaped); unknown names stay visible, so the check catches them. */
const fill = (template, vars = {}) => esc(template).replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));

function companyVars(lang) {
  const country = new Intl.DisplayNames([lang], { type: 'region' }).of(company.country) ?? company.country;
  return {
    company: esc(company.name),
    orgNumber: `<span class="ltr">${esc(company.orgNumber)}</span>`,
    email: `<a href="mailto:${esc(company.email)}" class="ltr">${esc(company.email)}</a>`,
    country: esc(country),
    // The business address from the Register of Business Enterprises (data/company.json), then the country.
    address: [...(company.address ?? []), country].map(esc).join(', '),
  };
}

/** Prompt 129: an app's privacy facts as placeholders – numbers in the page's language, the providers' terms as links. */
function factVars(slug, lang) {
  const f = privacyFacts.apps?.[slug];
  if (!f) return {};
  const n = (x) => new Intl.NumberFormat(lang).format(x);
  const link = (url) => `<a href="${esc(url)}" class="ltr" rel="noopener">${esc(new URL(url).host.replace(/^www\./, ''))}</a>`;
  return {
    ...Object.fromEntries(Object.entries(f.numbers).map(([k, v]) => [k, n(v)])),
    ...Object.fromEntries(Object.entries(f.terms).map(([k, url]) => [`link${k}`, link(url)])),
    // The app's own menu names in this language ({{menuMe}}, {{menuExport}}, {{menuDelete}}, {{menuDeleteConfirm}}).
    ...Object.fromEntries(Object.entries(f.labels?.[lang] ?? {}).map(([k, v]) => [k, esc(v)])),
  };
}

const formatDate = (iso, lang) => new Intl.DateTimeFormat(lang, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const dirOf = (lang) => (CORE_LANGUAGES.find((l) => l.code === lang)?.rtl ? 'rtl' : 'ltr');

// --- layout ---

function layout({ lang, title, description, pagePath, body }) {
  const c = common[lang];
  const vars = companyVars(lang);
  const url = (l) => `${ORIGIN}/${l}${pagePath}`;
  const alternates = LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${url(l)}">`).join('\n  ');
  const languages = CORE_LANGUAGES.map(
    (l) => `<li><a href="/${l.code}${pagePath}" lang="${l.code}" dir="${l.rtl ? 'rtl' : 'ltr'}"${l.code === lang ? ' aria-current="true"' : ''}>${esc(l.nativeName)}</a></li>`,
  ).join('');
  const year = apps.reduce((y, a) => (a.lastUpdated && a.lastUpdated.slice(0, 4) > y ? a.lastUpdated.slice(0, 4) : y), '2026');
  return `<!doctype html>
<html lang="${lang}" dir="${dirOf(lang)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta name="color-scheme" content="light dark">
  <link rel="canonical" href="${url(lang)}">
  ${alternates}
  <link rel="alternate" hreflang="x-default" href="${ORIGIN}${pagePath}">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="stylesheet" href="/assets/fonts/inter.css">
  <link rel="stylesheet" href="/assets/pages.css">
</head>
<body>
  <a class="skip" href="#content">${fill(c.skipToContent)}</a>
  <header class="site">
    <div class="wrap">
      <a class="logo" href="/" aria-label="${fill(c.home)} – ${vars.company}">
        <picture>
          <source srcset="/assets/logo-horizontal-dark.svg" media="(prefers-color-scheme: dark)">
          <img src="/logo-horizontal.svg" alt="${vars.company}" width="144" height="45">
        </picture>
      </a>
      <details class="languages">
        <summary aria-label="${fill(c.language)}">${fill(c.language)}: ${esc(CORE_LANGUAGES.find((l) => l.code === lang).nativeName)}</summary>
        <ul>${languages}</ul>
      </details>
    </div>
  </header>
  <main id="content" class="wrap">
${body}
  </main>
  <footer class="site">
    <div class="wrap">
      <p>© ${year} ${vars.company}. ${fill(c.footer.rights)}</p>
      <p>${fill(c.footer.orgNumber, { value: vars.orgNumber })}</p>
      <nav aria-label="${fill(c.footer.privacy)}">
        <a href="/${lang}/privacy">${fill(c.footer.privacy)}</a>
        <a href="mailto:${esc(company.email)}">${fill(c.footer.contact)}</a>
      </nav>
    </div>
  </footer>
</body>
</html>
`;
}

// --- page bodies ---

function sectionHtml(s, lang, vars) {
  const c = common[lang];
  const planned = s.planned ? `<span class="planned-badge">${fill(c.planned)}</span>` : '';
  const parts = [`<section${s.planned ? ' class="planned"' : ''}>`, `<h2>${fill(s.heading, vars)}${planned}</h2>`];
  if (s.planned) parts.push(`<p class="planned-note">${fill(c.plannedNote)}</p>`);
  // Steps first (what to do), then the explanation.
  if (s.steps) parts.push(`<ol>${s.steps.map((x) => `<li>${fill(x, vars)}</li>`).join('')}</ol>`);
  for (const p of s.body ?? []) parts.push(`<p>${fill(p, vars)}</p>`);
  if (s.list) parts.push(`<ul>${s.list.map((x) => `<li>${fill(x, vars)}</li>`).join('')}</ul>`);
  for (const p of s.after ?? []) parts.push(`<p>${fill(p, vars)}</p>`);
  parts.push('</section>');
  return parts.join('\n');
}

function appPage(app, page, lang) {
  const c = common[lang];
  const a = appTexts[app.slug][lang];
  // Supabase's data centre: the country's name in the page's language (data/apps.json: supabase.country, e.g. IE).
  const region = app.supabase?.country ? (new Intl.DisplayNames([lang], { type: 'region' }).of(app.supabase.country) ?? app.supabase.country) : null;
  const vars = {
    ...companyVars(lang),
    ...factVars(app.slug, lang),
    server: region ? fill(a.serverRegion, { region: esc(region) }) : fill(a.server),
    // The data centre's country alone (privacy: where sign-in and sync are stored).
    region: region ? esc(region) : '',
    supabaseRegion: region ? ` (${esc(region)})` : '',
  };
  const pageTitle = fill(c.pages[page]);
  const nav = `<ul class="page-nav">${app.pages
    .map((p) => `<li><a href="/${lang}/${app.slug}/${p}"${p === page ? ' aria-current="page"' : ''}>${fill(c.pages[p])}</a></li>`)
    .join('')}</ul>`;
  const head = [
    `<p class="app-name">${esc(app.name)}</p>`,
    `<h1>${pageTitle}</h1>`,
  ];
  let body;
  if (page === 'privacy' || page === 'terms' || page === 'delete-account') {
    // Terms of use: the same layout as the privacy policy (intro, last updated, sections).
    const content = page === 'privacy' ? a.privacy : page === 'terms' ? a.terms : a.deleteAccount;
    body = [
      ...head,
      `<p class="lede">${fill(content.intro, vars)}</p>`,
      `<p class="updated">${fill(c.lastUpdated, { date: esc(formatDate(app.lastUpdated, lang)) })}</p>`,
      nav,
      ...content.sections.map((s) => sectionHtml(s, lang, vars)),
    ];
  } else {
    body = [
      ...head,
      `<p class="lede">${fill(a.support.intro, vars)}</p>`,
      nav,
      `<section class="card"><h2>${fill(a.support.contactHeading)}</h2><p>${fill(a.support.contactBody, vars)}</p></section>`,
      `<section class="faq"><h2>${fill(a.support.faqHeading)}</h2>`,
      // Round 40c: no Free/Pro comparison on the site (limits, prices, trial and what Pro has live only in the app, so
      // the pages never need updating when the app changes) – one line pointing to Pro in the app.
      `<p>${fill(a.support.proNote, vars)}</p>`,
      ...a.support.faq.map((f) => `<details><summary>${fill(f.q, vars)}</summary><p>${fill(f.a, vars)}</p></details>`),
      '</section>',
    ];
  }
  return layout({
    lang,
    title: fill(c.appPage, { app: esc(app.name), page: pageTitle }),
    description: fill(a.description),
    pagePath: `/${app.slug}/${page}`,
    body: body.map((l) => `    ${l}`).join('\n'),
  });
}

// --- sign-in links (Universal Links / App Links) ---

/**
 * /<lang>/<app>/auth/callback: where the sign-in link in the e-mail lands. The e-mail links straight
 * here with `?token_hash=…&type=…` (app-core directLink), so with the app installed the phone opens the
 * app at the tap (Universal Link / App Link) and the app signs in. Otherwise (Gmail's browser, no app)
 * this page offers a button that opens the app with the same parameters. On a computer it says the link
 * cannot sign in here: open it on the phone with the app, or type the code from the e-mail in the app.
 * The page never uses the token itself (a link scanner opening it does not use it up). No tracking,
 * nothing stored. Without JavaScript the phone texts and the code hint are shown.
 */
function authCallbackPage(app, lang) {
  const a = appTexts[app.slug][lang].authCallback;
  const scheme = `${app.links.scheme}://auth/callback`;
  const body = [
    `<p class="app-name">${esc(app.name)}</p>`,
    `<h1 id="title">${fill(a.title)}</h1>`,
    `<p class="lede" id="status">${fill(a.body)}</p>`,
    `<p id="open-row"><a class="button" id="open" href="${esc(scheme)}">${fill(a.open)}</a></p>`,
    `<p class="updated" id="hint">${fill(a.codeHint)}</p>`,
    `<script>
(function () {
  var params = location.search.slice(1) + '&' + location.hash.slice(1);
  // Everything the e-mail or Supabase put in the address goes to the app: token_hash/type in the query,
  // or tokens in the «#» part (older links).
  document.getElementById('open').href = ${JSON.stringify(scheme)} + location.search + location.hash;
  if (/(^|&)error(_code)?=/.test(params)) {
    document.getElementById('status').textContent = ${JSON.stringify(a.expired)};
    return;
  }
  var phone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // On a phone with a sign-in in the link, open the app straight away (Gmail's own browser does not open
  // Universal Links); the button stays for when the phone asks or blocks it. Only with JavaScript, so a link
  // scanner never does it, and the page itself never uses the token.
  if (phone && /(^|&)(token_hash|access_token|code)=/.test(params)) {
    setTimeout(function () { location.href = document.getElementById('open').href; }, 300);
  }
  if (!phone) {
    document.getElementById('title').textContent = ${JSON.stringify(a.desktopTitle)};
    document.getElementById('status').textContent = ${JSON.stringify(a.desktopBody)};
    document.getElementById('open-row').style.display = 'none';
    document.getElementById('hint').style.display = 'none';
    document.title = ${JSON.stringify(`${app.name} – ${a.desktopTitle}`)};
  }
})();
</script>`,
  ];
  return layout({
    lang,
    title: `${esc(app.name)} – ${fill(a.title)}`,
    description: fill(a.body),
    pagePath: `/${app.slug}/auth/callback`,
    body: body.map((l) => `    ${l}`).join('\n'),
  });
}

/** apple-app-site-association: which paths open which iOS app (one entry per app with links). */
function appleAppSiteAssociation() {
  const details = apps
    .filter((a) => a.links)
    .map((a) => ({ appIDs: [a.links.appleAppId], components: [{ '/': `/*/${a.slug}/auth/callback*`, comment: `${a.name}: sign-in links` }] }));
  return JSON.stringify({ applinks: { details } }, null, 2) + '\n';
}

/** assetlinks.json: which Android apps (package + signing keys: EAS now, Play App Signing at launch) may open links here. */
function assetLinks() {
  const entries = apps
    .filter((a) => a.links)
    .map((a) => ({
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: a.links.androidPackage, sha256_cert_fingerprints: [...a.links.androidSha256, ...a.links.androidSha256PlayAppSigning] },
    }));
  return JSON.stringify(entries, null, 2) + '\n';
}

function overviewPage(lang) {
  const c = common[lang];
  const o = c.overview;
  const vars = companyVars(lang);
  const items = apps.map((app) => {
    const href = (page) => (app.slug ? `/${lang}/${app.slug}/${page}` : app.external[page]?.replace('{lang}', lang) ?? null);
    const external = !app.slug;
    const links = [
      ['privacy', o.privacy],
      ['terms', o.terms],
      ['delete-account', o.deleteAccount],
      ['support', o.support],
    ]
      .filter(([page]) => href(page))
      .map(([page, label]) => `<li><a href="${esc(href(page))}"${external ? ` rel="noopener" aria-label="${fill(label)} – ${esc(app.name)} (${fill(o.external)})"` : ''}>${fill(label)}</a></li>`)
      .join('');
    return `<li class="card"><h2>${esc(app.name)}</h2><ul class="links">${links}</ul></li>`;
  });
  return layout({
    lang,
    title: `${fill(o.title)} – ${vars.company}`,
    description: fill(o.intro, vars).replace(/<[^>]+>/g, ''),
    pagePath: '/privacy',
    body: [`    <h1>${fill(o.title)}</h1>`, `    <p class="lede">${fill(o.intro, vars)}</p>`, `    <ul class="apps">${items.join('')}</ul>`].join('\n'),
  });
}

/** Without a language in the address: the middleware sends the visitor to their language; if it does not run, English. */
function fallbackPage(pagePath) {
  const c = common[FALLBACK_LANGUAGE];
  const target = `/${FALLBACK_LANGUAGE}${pagePath}`;
  const links = CORE_LANGUAGES.map((l) => `<li><a href="/${l.code}${pagePath}" lang="${l.code}">${esc(l.nativeName)}</a></li>`).join('');
  return `<!doctype html>
<html lang="${FALLBACK_LANGUAGE}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="0; url=${target}">
  <link rel="canonical" href="${ORIGIN}${target}">
  <title>${fill(c.redirect)}</title>
  <link rel="stylesheet" href="/assets/pages.css">
</head>
<body>
  <main class="wrap"><h1>${fill(c.redirect)}</h1><ul>${links}</ul></main>
</body>
</html>
`;
}

// --- the front page: company details from data/company.json ---

function homePage() {
  // The template's first line is a note for whoever edits it; the page starts with <!DOCTYPE>.
  const template = fs.readFileSync(path.join(root, 'templates/home.html'), 'utf8').replace(/^<!--[\s\S]*?-->\r?\n/, '');
  const out = template
    .replace(/\{\{company\.name\}\}/g, esc(company.name))
    .replace(/\{\{company\.orgNumber\}\}/g, esc(company.orgNumber))
    .replace(/\{\{company\.email\}\}/g, esc(company.email));
  const left = out.match(/\{\{[^}]+\}\}/);
  if (left) throw new Error(`templates/home.html: unknown ${left[0]}`);
  return out;
}

// --- the language middleware (Vercel Routing Middleware) ---

function middleware(paths) {
  return `// Generated by scripts/build-pages.mjs from data/apps.json – do not edit.
// An address without a language (e.g. /saldo-pocket/privacy) goes to the visitor's language from the
// browser (Accept-Language), matched by app-core's rule (the same as the apps: nb/no/nn, pt → pt-BR,
// zh → zh-Hans), else English.
import { CORE_LANGUAGES, resolveLanguage } from 'app-core';

const LANGUAGES = CORE_LANGUAGES.map((l) => l.code);

export const config = { runtime: 'nodejs', matcher: ${JSON.stringify(paths)} };

/** «nb-NO,nb;q=0.9,en;q=0.8» → the browser's languages, most wanted first. */
export function browserLocales(header) {
  return String(header ?? '')
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = Number(params.map((p) => p.trim()).find((p) => p.startsWith('q='))?.slice(2) ?? 1);
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((x) => x.tag && x.tag !== '*' && x.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .flatMap(({ tag }) => {
      try {
        const locale = new Intl.Locale(tag);
        return [{ languageTag: locale.baseName, languageCode: locale.language, languageScriptCode: locale.script ?? null, regionCode: locale.region ?? null }];
      } catch {
        return [];
      }
    });
}

export function languageFor(header) {
  return resolveLanguage(browserLocales(header), LANGUAGES);
}

export default function middleware(request) {
  const url = new URL(request.url);
  url.pathname = \`/\${languageFor(request.headers.get('accept-language'))}\${url.pathname}\`;
  return new Response(null, { status: 307, headers: { Location: url.toString(), Vary: 'Accept-Language', 'Cache-Control': 'private, no-store' } });
}
`;
}

// --- all files ---

const files = new Map();
for (const lang of LANGS) {
  files.set(`${lang}/privacy.html`, overviewPage(lang));
  for (const app of apps.filter((a) => a.slug)) for (const page of app.pages) files.set(`${lang}/${app.slug}/${page}.html`, appPage(app, page, lang));
  for (const app of apps.filter((a) => a.links)) files.set(`${lang}/${app.slug}/auth/callback.html`, authCallbackPage(app, lang));
}
files.set('.well-known/apple-app-site-association', appleAppSiteAssociation());
files.set('.well-known/assetlinks.json', assetLinks());
const unprefixed = ['/privacy', ...apps.filter((a) => a.slug).flatMap((a) => a.pages.map((p) => `/${a.slug}/${p}`))];
for (const p of unprefixed) files.set(`${p.slice(1)}.html`, fallbackPage(p));
files.set('index.html', homePage());
files.set('middleware.js', middleware(unprefixed));

// Prompt 129: the legal pages say the same on every language – the same sections and items as the source language (nb),
// the same placeholders in every text (numbers, links, menu names, company details come from one source), and every
// recipient of the app's data named on every language (the app's own list, data/privacy-facts.json).
for (const app of apps.filter((a) => a.slug)) {
  const shape = (v) => (Array.isArray(v) ? v.map(shape) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : typeof v === 'string' ? [...new Set(v.match(/\{\{\w+\}\}/g) ?? [])].sort().join(' ') : v);
  for (const key of ['privacy', 'deleteAccount']) {
    const source = JSON.stringify(shape(appTexts[app.slug].nb[key]));
    for (const lang of LANGS) if (JSON.stringify(shape(appTexts[app.slug][lang][key])) !== source) throw new Error(`${app.slug} ${lang} ${key}: sections, items or placeholders differ from nb`);
  }
  const names = privacyFacts.apps?.[app.slug]?.recipients ?? [];
  for (const lang of LANGS) {
    const text = JSON.stringify(appTexts[app.slug][lang].privacy);
    for (const name of names) if (!text.includes(name)) throw new Error(`${app.slug} ${lang} privacy: recipient ${name} not named`);
  }
}

for (const [file, content] of files) {
  const left = content.match(/\{\{\w+\}\}/);
  if (left) throw new Error(`${file}: unfilled ${left[0]}`);
}

if (process.argv.includes('--check')) {
  // Line ends do not count (git may check files out with CRLF on Windows).
  const same = (file, content) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n') === content.replace(/\r\n/g, '\n');
  const stale = [...files].filter(([file, content]) => !fs.existsSync(path.join(root, file)) || !same(file, content)).map(([f]) => f);
  if (stale.length) {
    console.error(`Pages not up to date (run npm run build:pages): ${stale.slice(0, 10).join(', ')}${stale.length > 10 ? ` and ${stale.length - 10} more` : ''}`);
    process.exit(1);
  }
  console.log(`Pages up to date: ${files.size} files, ${LANGS.length} languages.`);
} else {
  for (const [file, content] of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  console.log(`Wrote ${files.size} files (${LANGS.length} languages).`);
}
