// The store links and the official store badges – ONE component for every page that shows an app in the stores
// (the front page's app cards, Saldo Pocket's support page). The apps' store ids live in data/apps.json (home.stores);
// the badge files and which languages have their own are listed here.
//
// The badges are the stores' own artwork, unchanged (never redrawn, recoloured or translated by us):
// - App Store: «Download on the App Store», from Apple's marketing toolbox
//   https://toolbox.marketingtools.apple.com/api/badges/download-on-the-app-store/<black|white>/<code> (SVG). Black on light
//   pages, white on dark pages (Apple's two versions). Apple has no Hindi badge: hi shows the English one.
// - Google Play: «Get it on Google Play», https://play.google.com/intl/en_us/badges/static/images/badges/<code>_badge_web_generic.png
//   (only the transparent margin around the badge removed, so every language lines up). Google has one version for every
//   background.
// Both are shown at the same height (BADGE_HEIGHT, above Apple's minimum of 40 px and the 44 px touch target), with a clear
// space of a quarter of the height around each (assets/store-badges.css).
import { PLATFORM_LANGUAGE_CODES } from 'app-core';

export const BADGE_HEIGHT = 48;

/** Our language → the store's badge language (the file in /assets/badges/). A language missing here shows English. */
export const STORE_BADGES = {
  appStore: {
    // The toolbox's codes: nb = no-no, ar = ar-ar, zh-Hans = zh-cn, pt-BR = pt-br; the rest <lang>-<country>.
    languages: ['nb', 'en', 'es', 'pt-BR', 'fr', 'de', 'it', 'ja', 'ko', 'zh-Hans', 'sv', 'da', 'nl', 'pl', 'tr', 'ar', 'fi'],
    width: 119.66407,
    height: 40,
  },
  googlePlay: {
    // Google's codes: nb = no, zh-Hans = zh-cn, pt-BR = pt-br; the rest the language code.
    languages: ['nb', 'en', 'es', 'pt-BR', 'fr', 'de', 'it', 'ja', 'ko', 'zh-Hans', 'sv', 'da', 'nl', 'pl', 'tr', 'ar', 'hi', 'fi'],
    width: 646,
    height: 192,
  },
};

const badgeLang = (store, lang) => (STORE_BADGES[store].languages.includes(lang) ? lang : 'en');

/** The badge files for a store and page language (the App Store has a light and a dark one). */
export function badgeFiles(store, lang) {
  const l = badgeLang(store, lang);
  return store === 'appStore'
    ? { light: `/assets/badges/app-store-black-${l}.svg`, dark: `/assets/badges/app-store-white-${l}.svg` }
    : { light: `/assets/badges/google-play-${l}.png`, dark: null };
}

/** The store links: App Store without a country (Apple opens the visitor's own storefront), Google Play in the page's language. */
export function storeLinks(stores, lang) {
  const hl = PLATFORM_LANGUAGE_CODES[lang]?.googlePlay ?? lang;
  return {
    appStore: stores.appStore ? `https://apps.apple.com/app/id${stores.appStore}` : null,
    googlePlay: stores.googlePlay ? `https://play.google.com/store/apps/details?id=${encodeURIComponent(stores.googlePlay)}&hl=${encodeURIComponent(hl)}` : null,
  };
}

const STORE_NAMES = { appStore: 'App Store', googlePlay: 'Google Play' };

/**
 * The two badges as links, App Store first; on an Android phone Google Play comes first (STORE_ORDER_SCRIPT), but both are
 * always shown. `label` is the page's «{{app}} on {{store}}» (i18n/home store.label) – the link's name for screen readers.
 */
export function storeBadges({ stores, appName, lang, label, esc, fill }) {
  const links = storeLinks(stores, lang);
  const badge = (store) => {
    if (!links[store]) return '';
    const { light, dark } = badgeFiles(store, lang);
    const { width, height } = STORE_BADGES[store];
    const w = Math.round((width / height) * BADGE_HEIGHT);
    const img = `<img src="${light}" alt="" width="${w}" height="${BADGE_HEIGHT}" loading="lazy" decoding="async">`;
    return `<a class="store-badge ${store === 'appStore' ? 'app-store' : 'google-play'}" href="${esc(links[store])}" rel="noopener" aria-label="${fill(label, { app: esc(appName), store: STORE_NAMES[store] })}">${
      dark ? `<picture><source srcset="${dark}" media="(prefers-color-scheme: dark)">${img}</picture>` : img
    }</a>`;
  };
  return `<div class="store-badges">${badge('appStore')}${badge('googlePlay')}</div>`;
}

/**
 * What a page with badges adds to <head>: the badges' styles, and a line that marks the visitor's phone on <html data-os>,
 * so the badges can put its own store first (CSS order; nothing is hidden).
 */
export const STORE_BADGES_HEAD = `
  <link rel="stylesheet" href="/assets/store-badges.css">
  <script>
  (function () {
    var ua = navigator.userAgent || '';
    var ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    document.documentElement.setAttribute('data-os', ios ? 'ios' : /Android/.test(ua) ? 'android' : 'other');
  })();
  </script>`;
