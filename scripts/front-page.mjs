// The front page (/<lang>) and the admin page (/admin), built by scripts/build-pages.mjs.
// One source for each thing:
// - the apps: data/apps.json, the `home` part of each app (a new app = one entry; 2 apps = two columns, 3+ = a grid),
// - texts: i18n/home/<lang>.json (+ i18n/common for the shared words),
// - colours: data/theme.json (light and dark tokens; scripts/check-contrast.mjs checks the pairs),
// - languages: app-core (the same 18 as the apps, in the apps' order: languageChoiceOrder).
import { CORE_LANGUAGES, PLATFORM_LANGUAGE_CODES, languageChoiceOrder } from 'app-core';

export const LANGUAGE_COOKIE = 'lang';

const GLOBE = '<svg class="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.6" d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18Zm-9 9h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z"/></svg>';
const APPLE = '<svg class="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8 1.5 0 1.9.8 3.2.8 1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8 0 0-2.5-1-2.5-3.9ZM14 5.4c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.6 2.8-1.4Z"/></svg>';
const PLAY = '<svg class="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4.2 2.6c-.3.3-.4.7-.4 1.2v16.4c0 .5.1.9.4 1.2l9.3-9.4-9.3-9.4Zm10.4 10.5 2.6 2.6-11.1 6.3c-.4.2-.8.2-1.1.1l9.6-9Zm0-2.2L5 1.9c.3-.1.7-.1 1.1.1l11.1 6.3-2.6 2.6Zm3.9-1.8 3 1.7c.9.5.9 1.8 0 2.3l-3 1.7-2.8-2.8 2.8-2.9Z"/></svg>';
const ARROW = '<svg class="icon dir" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M7 17 17 7M9 7h8v8"/></svg>';

/** The store links: App Store (Apple picks the visitor's storefront), Google Play in the page's language. */
function storeLinks(stores, lang) {
  const hl = PLATFORM_LANGUAGE_CODES[lang]?.googlePlay ?? lang;
  return {
    appStore: stores.appStore ? `https://apps.apple.com/app/id${stores.appStore}` : null,
    googlePlay: stores.googlePlay ? `https://play.google.com/store/apps/details?id=${encodeURIComponent(stores.googlePlay)}&hl=${encodeURIComponent(hl)}` : null,
  };
}

/** The app's own pages: on this site (slug) or on the app's own website (external, {lang} filled in). */
function pageHref(app, page, lang) {
  if (app.slug) return app.pages?.includes(page) ? `/${lang}/${app.slug}/${page}` : null;
  return app.external?.[page]?.replace('{lang}', lang) ?? null;
}

/** The language menu: globe + the language's own name; the 18 in the apps' order (app-core). The choice is kept in a cookie. */
function languageMenu({ lang, pagePath, esc, label }) {
  const current = CORE_LANGUAGES.find((l) => l.code === lang);
  const items = languageChoiceOrder(CORE_LANGUAGES)
    .map((code) => CORE_LANGUAGES.find((l) => l.code === code))
    .map((l) => `<li><a href="/${l.code}${pagePath}" hreflang="${l.code}" lang="${l.code}" dir="${l.rtl ? 'rtl' : 'ltr'}" data-lang="${l.code}"${l.code === lang ? ' aria-current="true"' : ''}>${esc(l.nativeName)}</a></li>`)
    .join('');
  return `<details class="lang-menu">
        <summary aria-label="${label}: ${esc(current.nativeName)}">${GLOBE}<span>${esc(current.nativeName)}</span></summary>
        <ul>${items}</ul>
      </details>`;
}

/** Remembers a language chosen in the menu, so «/» and addresses without a language open it next time (the middleware reads it). */
const rememberScript = `<script>
document.addEventListener('click', function (e) {
  var a = e.target.closest && e.target.closest('a[data-lang]');
  if (a) document.cookie = '${LANGUAGE_COOKIE}=' + a.getAttribute('data-lang') + '; path=/; max-age=31536000; samesite=lax';
});
</script>`;

/** <head> shared by the front page and /admin. */
function head({ lang, dir, title, description, canonical, alternates, esc, extra = '' }) {
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta name="color-scheme" content="light dark">
  ${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
  ${alternates ?? ''}
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="preload" href="/assets/fonts/hanken-grotesk-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/fonts/hanken-grotesk.css">
  <link rel="stylesheet" href="/assets/home-tokens.css">
  <link rel="stylesheet" href="/assets/home.css">${extra}
</head>`;
}

function logo(lang, company, esc, homeLabel) {
  // The wordmark «Olstad Digital» as text: sharp at every size, in both modes (the text token).
  return `<a class="logo" href="/${lang}" aria-label="${homeLabel} – ${esc(company.name)}" lang="en" dir="ltr">${esc(company.name)}</a>`;
}

function footer({ lang, company, esc, fill, common, home, year }) {
  return `<footer class="bar">
    <div class="wrap bar-row">
      <p class="bar-facts">
        <span>© ${year} ${esc(company.name)}</span>
        <span>${fill(common.footer.orgNumber, { value: `<span class="ltr">${esc(company.orgNumber)}</span>` })}</span>
        <a href="mailto:${esc(company.email)}" class="ltr">${esc(company.email)}</a>
      </p>
      <a class="sign-in" href="/admin?lang=${lang}">${fill(home.signIn)}</a>
    </div>
  </footer>`;
}

function appCard(app, { lang, esc, fill, h, about }) {
  const a = app.home;
  const name = esc(app.name);
  const stores = storeLinks(a.stores, lang);
  const meta = [fill(h.categories[a.category]), ...a.platforms.map(esc)].join('<span class="dot" aria-hidden="true">·</span>');
  const buttons = [];
  if (a.published) {
    if (stores.appStore) buttons.push(`<a class="btn store" href="${esc(stores.appStore)}" rel="noopener" aria-label="${fill(h.store.label, { app: name, store: 'App Store' })}">${APPLE}<span>App Store</span></a>`);
    if (stores.googlePlay) buttons.push(`<a class="btn store" href="${esc(stores.googlePlay)}" rel="noopener" aria-label="${fill(h.store.label, { app: name, store: 'Google Play' })}">${PLAY}<span>Google Play</span></a>`);
  }
  if (a.website) buttons.push(`<a class="btn ghost" href="${esc(a.website)}" rel="noopener">${esc(new URL(a.website).host.replace(/^www\./, ''))}${ARROW}</a>`);
  const soon = a.published ? '' : `<p class="soon">${fill(h.store.comingSoon)}</p>`;
  const linkLabel = { privacy: h.links.privacy, support: h.links.support, 'delete-account': h.links.deleteData };
  const links = a.links
    .map((page) => [page, pageHref(app, page, lang)])
    .filter(([, href]) => href)
    .map(([page, href]) => `<li><a href="${esc(href)}"${app.slug ? '' : ' rel="noopener"'}>${fill(linkLabel[page])}</a></li>`)
    .join('');
  return `<article class="app" style="--app:${esc(a.color.light)};--app-dark:${esc(a.color.dark)}" aria-labelledby="app-${esc(a.id)}">
        <div class="shot">
          <img src="${esc(a.image)}" alt="${fill(h.imageAlt, { app: name })}" width="900" height="1200" loading="lazy" decoding="async">
        </div>
        <div class="app-body">
          <div class="app-head">
            <img class="app-icon" src="${esc(a.icon)}" alt="" width="56" height="56">
            <div>
              <h3 id="app-${esc(a.id)}">${name}</h3>
              <p class="meta">${meta}</p>
            </div>
          </div>
          <p class="about">${about(a.id)}</p>
          ${buttons.length ? `<div class="buttons">${buttons.join('')}</div>` : ''}
          ${soon}
          <ul class="app-links" aria-label="${name}">${links}</ul>
        </div>
      </article>`;
}

export function frontPage({ lang, dir, apps, company, home: h, common, esc, fill, origin, langs, year, storeTexts }) {
  const shown = apps.filter((a) => a.home).sort((x, y) => Number(y.home.published) - Number(x.home.published));
  const alternates = [...langs.map((l) => `<link rel="alternate" hreflang="${l}" href="${origin}/${l}">`), `<link rel="alternate" hreflang="x-default" href="${origin}/">`].join('\n  ');
  // The sentence about each app: the app's own store short description (data/app-texts.json, written by the app's
  // sync script – ONE source with the store listing), else i18n/home about.<id> for an app without one in its code.
  const about = (id) => (storeTexts?.[id]?.about?.[lang] ? esc(storeTexts[id].about[lang]) : fill(h.about[id]));
  const ctx = { lang, esc, fill, h, common, about };
  const principle = (k) => `<li><h3>${fill(h.principles[k].title)}</h3><p>${fill(h.principles[k].body)}</p></li>`;
  return `${head({ lang, dir, title: fill(h.title), description: fill(h.hero.body), canonical: `${origin}/${lang}`, alternates, esc })}
<body>
  <a class="skip" href="#content">${fill(common.skipToContent)}</a>
  <header class="top">
    <div class="wrap top-row">
      ${logo(lang, company, esc, fill(common.home))}
      <nav class="top-nav" aria-label="${fill(h.nav.apps)} / ${fill(h.nav.principles)}">
        <a href="#apps">${fill(h.nav.apps)}</a>
        <a href="#principles">${fill(h.nav.principles)}</a>
      </nav>
      ${languageMenu({ lang, pagePath: '', esc, label: fill(common.language) })}
    </div>
  </header>
  <main id="content">
    <section class="wrap hero">
      <h1>${fill(h.hero.title)}</h1>
      <p>${fill(h.hero.body)}</p>
    </section>
    <section class="wrap" id="apps" aria-labelledby="apps-heading">
      <h2 id="apps-heading" class="section-label">${fill(h.appsHeading)}</h2>
      <div class="apps${shown.length === 2 ? ' two' : ''}">
      ${shown.map((a) => appCard(a, ctx)).join('\n      ')}
      </div>
    </section>
    <section class="wrap" id="principles" aria-labelledby="principles-heading">
      <h2 id="principles-heading" class="section-label">${fill(h.principles.heading)}</h2>
      <ul class="principles">${['privacy', 'language', 'ads'].map(principle).join('')}</ul>
    </section>
  </main>
  ${footer({ lang, company, esc, fill, common, home: h, year })}
  ${rememberScript}
</body>
</html>
`;
}

/**
 * «Til godkjenning» – the same button at the top of every app's admin page (Marco's rule: everything that waits for his
 * approval is collected there). data/apps.json home.approval.url = the app's own approval queue, opened unchanged in a new
 * tab with its own sign-in (PlanTravel: plantravelapp.com/admin/approval-queue on PlanTravel's server, the queue behind the
 * old admin). No queue (home.approval null) = the button shows «Nothing is waiting for approval».
 */
export function approvalButton(app, t, esc) {
  const url = app.home.approval?.url;
  const label = `<span data-t="approval">${esc(t.approval)}</span>`;
  if (url) {
    return `<div class="admin-approval">
        <a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener">${label}</a>
        <p class="muted stats-note" data-t="approvalHint">${esc(t.approvalHint)}</p>
      </div>`;
  }
  return `<div class="admin-approval">
        <button class="btn primary" type="button" id="approval-open" aria-expanded="false" aria-controls="approval-empty">${label}</button>
        <p class="admin-card muted" id="approval-empty" data-t="approvalEmpty" hidden>${esc(t.approvalEmpty)}</p>
      </div>`;
}

/**
 * /admin and /admin/<app>: sign in with e-mail + a one-time code (Supabase, the Saldo project), only for the addresses in
 * the server's allowlist (Vercel environment ADMIN_EMAILS, checked in api/admin.js – never in the page). Everyone else is
 * refused before any code is sent. After sign-in, /admin shows one card per app in the app list (data/apps.json, every
 * app with a «home» part – a new app there = a new card and page), and /admin/<app> the statistics for that app, fetched
 * from /api/admin (action «stats»; «No data yet» until the app has a source). The page is in the visitor's language (the
 * saved choice, ?lang=, or the browser's), with every language's texts from i18n/home (admin.*).
 */
export function adminPage({ homes, company, esc, fallback, apps, app = null, eventNames = null }) {
  // The app's names for its usage events per language (data/<app>-event-names.json, the app's own file); a missing name = the id.
  const namesScript = eventNames ? `
  var NAMES = ${JSON.stringify(eventNames).replace(/</g, '\u003c')};` : '';
  const texts = JSON.stringify(Object.fromEntries(Object.entries(homes).map(([l, h]) => [l, { ...h.admin, signIn: h.signIn }]))).replace(/\{\{(\w+)\}\}/g, '%$1%'); // {{x}} → %x% (filled in the page)
  const rtl = JSON.stringify(CORE_LANGUAGES.filter((l) => l.rtl).map((l) => l.code));
  const t = homes[fallback].admin;
  const icon = (a) => `<img class="app-icon" src="${esc(a.home.icon)}" alt="" width="56" height="56">`;
  const back = `<svg class="icon dir" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M15 6l-6 6 6 6"/></svg>`;
  const next = `<svg class="icon dir" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M9 6l6 6-6 6"/></svg>`;
  const status = (a) => (a.home.stats ? 'seeStats' : 'noData');
  const inside = app
    ? `<a class="back" href="/admin">${back}<span data-t="allApps">${esc(t.allApps)}</span></a>
      ${approvalButton(app, t, esc)}
      <div class="admin-app-head">${icon(app)}<h2>${esc(app.name)}</h2></div>
      ${app.home.stats?.source ? `<label class="admin-toggle"><input type="checkbox" id="include-test" role="switch"><span data-t="includeTest">${esc(t.includeTest)}</span></label>` : ''}
      <div id="stats" class="admin-stats" data-app="${esc(app.home.id)}" aria-live="polite"><p class="admin-card muted" data-t="checking">${esc(t.checking)}</p></div>`
    : `<h2 data-t="apps">${esc(t.apps)}</h2>
      <ul class="admin-apps">${apps
        .filter((a) => a.home)
        .map((a) => `<li><a class="admin-card admin-app-link" href="/admin/${esc(a.home.id)}">${icon(a)}<span class="admin-app-text"><strong>${esc(a.name)}</strong><span class="muted" data-t="${status(a)}">${esc(t[status(a)])}</span></span>${next}</a></li>`)
        .join('')}</ul>`;
  return `${head({ lang: fallback, dir: 'ltr', title: `${esc(app ? app.name : t.title)} – ${esc(company.name)}`, description: esc(t.title), canonical: null, esc, extra: '\n  <meta name="robots" content="noindex, nofollow">' })}
<body>
  <header class="top">
    <div class="wrap top-row">
      ${logo(fallback, company, esc, esc(company.name))}
    </div>
  </header>
  <main id="content" class="wrap admin${app ? ' admin-wide' : ''}">
    <h1 data-t="title">${esc(t.title)}</h1>
    <form id="email-form" class="admin-form" hidden>
      <label for="email" data-t="email">${esc(t.email)}</label>
      <input id="email" name="email" type="email" autocomplete="email" required>
      <button class="btn primary" type="submit" data-t="sendCode">${esc(t.sendCode)}</button>
    </form>
    <form id="code-form" class="admin-form" hidden>
      <p id="sent"></p>
      <label for="code" data-t="code">${esc(t.code)}</label>
      <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" required>
      <button class="btn primary" type="submit" data-t="verify">${esc(t.verify)}</button>
    </form>
    <section id="inside" class="admin-inside" hidden>
      <p class="muted admin-who" id="who"></p>
      ${inside}
      <button class="btn ghost" id="sign-out" type="button" data-t="signOut">${esc(t.signOut)}</button>
    </section>
    <p id="message" role="status" aria-live="polite"></p>
  </main>
  <script>
(function () {
  var TEXTS = ${texts};
  var RTL = ${rtl};${namesScript}
  var saved = (document.cookie.match(/(?:^|; )${LANGUAGE_COOKIE}=([^;]+)/) || [])[1];
  var asked = new URLSearchParams(location.search).get('lang');
  var browser = (navigator.languages || [navigator.language]).map(function (l) { return l === 'nn' || l === 'no' || /^n[bno]-/.test(l) ? 'nb' : /^zh/.test(l) ? 'zh-Hans' : /^pt/.test(l) ? 'pt-BR' : l.split('-')[0]; });
  var lang = [asked, saved].concat(browser).filter(function (l) { return l && TEXTS[l]; })[0] || '${fallback}';
  var t = TEXTS[lang];
  document.documentElement.lang = lang;
  document.documentElement.dir = RTL.indexOf(lang) >= 0 ? 'rtl' : 'ltr';
  ${app ? '' : `document.title = t.title + ' – ${esc(company.name)}';`}
  document.querySelectorAll('[data-t]').forEach(function (el) { el.textContent = t[el.getAttribute('data-t')]; });
  var $ = function (id) { return document.getElementById(id); };
  var say = function (key, detail) { $('message').textContent = key ? t[key] + (detail ? ' (' + detail + ')' : '') : ''; };
  // The server's error code → its text; anything else says what failed (HTTP status and the server's code).
  var KEYS = { refused: 'refused', rate_limited: 'tooMany', not_configured: 'notConfigured', wrong_code: 'wrongCode', stats_not_configured: 'statsNotConfigured', source_refused: 'sourceRefused', source: 'sourceFailed', source_timeout: 'sourceFailed' };
  var failText = function (j) {
    if (KEYS[j.error]) return [KEYS[j.error], j.missing ? j.missing.join(', ') : j.code || ''];
    if (!j.status) return ['offline', ''];
    return ['failed', ['HTTP ' + j.status, j.code].filter(Boolean).join(' · ')];
  };
  var fail = function (j) { var f = failText(j); say(f[0], f[1]); };
  var call = function (body, token) {
    return fetch('/api/admin', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j.status = r.status; return j; }); });
  };
  var KEY = 'admin.session';
  var signedOut = function () { $('email-form').hidden = false; $('code-form').hidden = true; $('inside').hidden = true; };
  // The app page: the statistics from the server (data null = no source yet → «No data yet»; otherwise aggregate numbers,
  // laid out by /assets/admin-stats.js with textContent only, with the period choice at the top). Loading, error (with «Try again»)
  // and the test-traffic switch (the chosen period is kept when it fetches again).
  var line = function (box, text) {
    box.textContent = '';
    var p = document.createElement('p');
    p.className = 'admin-card muted';
    p.textContent = text;
    box.appendChild(p);
    return p;
  };
  var loadStats = function (token) {
    var box = $('stats');
    if (!box) return;
    var toggle = $('include-test');
    line(box, t.loading);
    box.setAttribute('aria-busy', 'true');
    var failed = function (j) {
      box.removeAttribute('aria-busy');
      var f = failText(j); // shown in the card (with «Try again»), not again under it
      var p = line(box, t[f[0]] + (f[1] ? ' (' + f[1] + ')' : ''));
      var again = document.createElement('button');
      again.type = 'button';
      again.className = 'btn ghost';
      again.textContent = t.retry;
      again.addEventListener('click', function () { say(''); loadStats(token); });
      p.appendChild(document.createElement('br'));
      p.appendChild(again);
    };
    call({ action: 'stats', app: box.getAttribute('data-app'), includeTest: !!(toggle && toggle.checked) }, token).then(function (j) {
      if (j.status !== 200) return failed(j);
      if (!j.data) { box.removeAttribute('aria-busy'); return line(box, t.noData); }
      return import('/assets/admin-stats.js').then(function (m) {
        m.mountStats(box, j.data, t, lang, typeof NAMES === 'object' ? NAMES[lang] || {} : {});
        box.removeAttribute('aria-busy');
      });
    }).catch(function () { failed({ error: 'offline', status: 0 }); });
  };
  // Back online after a failed load: try again by itself.
  window.addEventListener('online', function () {
    var tk; try { tk = sessionStorage.getItem(KEY); } catch (e) {}
    if (tk && $('stats') && $('stats').querySelector('.admin-card button')) { say(''); loadStats(tk); }
  });
  if ($('approval-open')) $('approval-open').addEventListener('click', function () {
    var open = $('approval-empty').hidden;
    $('approval-empty').hidden = !open;
    $('approval-open').setAttribute('aria-expanded', String(open));
  });
  if ($('include-test')) $('include-test').addEventListener('change', function () {
    var tk; try { tk = sessionStorage.getItem(KEY); } catch (e) {}
    if (tk) loadStats(tk);
  });
  var show = function (email, token) {
    $('email-form').hidden = true; $('code-form').hidden = true; $('inside').hidden = false; $('who').textContent = email; say('');
    loadStats(token);
  };
  var check = function (token) {
    say('checking');
    return call({ action: 'me' }, token).then(function (j) {
      if (j.status === 200) return show(j.email, token);
      try { sessionStorage.removeItem(KEY); } catch (e) {}
      signedOut();
      if (j.status === 401) say(''); else fail(j);
    }, function () { signedOut(); say('offline'); });
  };
  var token; try { token = sessionStorage.getItem(KEY); } catch (e) {}
  if (token) check(token); else signedOut();
  var email = '';
  $('email-form').addEventListener('submit', function (e) {
    e.preventDefault();
    email = $('email').value.trim();
    call({ action: 'code', email: email }).then(function (j) {
      if (j.status === 200) { $('email-form').hidden = true; $('code-form').hidden = false; $('sent').textContent = t.sent.replace('%email%', email); $('code').focus(); say(''); }
      else fail(j);
    }, function () { say('offline'); });
  });
  $('code-form').addEventListener('submit', function (e) {
    e.preventDefault();
    call({ action: 'verify', email: email, code: $('code').value.trim() }).then(function (j) {
      if (j.status === 200 && j.accessToken) { try { sessionStorage.setItem(KEY, j.accessToken); } catch (e) {} return check(j.accessToken); }
      fail(j);
    }, function () { say('offline'); });
  });
  $('sign-out').addEventListener('click', function () {
    try { sessionStorage.removeItem(KEY); } catch (e) {}
    location.href = '/admin';
  });
})();
  </script>
</body>
</html>
`;
}

/** The colour tokens as CSS custom properties: light on :root, dark under prefers-color-scheme (data/theme.json). */
export function tokensCss(theme) {
  const vars = (set) => Object.entries(set).map(([k, v]) => `  --${k}: ${v};`).join('\n');
  return `/* Generated by scripts/build-pages.mjs from data/theme.json – do not edit. */
:root {
${vars(theme.light)}
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
${vars(theme.dark).replace(/^/gm, '  ')}
    color-scheme: dark;
  }
}
`;
}
