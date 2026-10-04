import type { TranslationKey } from '@/lib/i18n';

export type HelpBrowser = 'safari' | 'chrome' | 'edge' | 'firefox' | 'samsung' | 'other';
export type HelpOs = 'ios' | 'android' | 'mac' | 'windows' | 'other';

// Browsers and in-app views built on another engine's user agent. Their menus
// differ from the browser they imitate, so they get the generic instruction.
const OTHER_BRANDS = /OPR\/|OPiOS|OPT\/|Opera|YaBrowser|Vivaldi|DuckDuckGo|UCBrowser|Brave|GSA\/|FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat|; wv\)/;

function detectOs(userAgent: string, maxTouchPoints: number): HelpOs {
  if (/Android/i.test(userAgent)) return 'android';
  // iPadOS asks for desktop sites as a Mac; only the touch screen gives it away.
  if (/iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return 'ios';
  if (/Macintosh|Mac OS X/.test(userAgent)) return 'mac';
  return /Windows/.test(userAgent) ? 'windows' : 'other';
}

function detectBrowserName(userAgent: string): HelpBrowser {
  if (/SamsungBrowser/.test(userAgent)) return 'samsung';
  if (/EdgiOS|EdgA|Edg\/|Edge\//.test(userAgent)) return 'edge';
  if (OTHER_BRANDS.test(userAgent)) return 'other';
  if (/FxiOS|Firefox\//.test(userAgent)) return 'firefox';
  if (/CriOS|Chrome\/|Chromium\//.test(userAgent)) return 'chrome';
  return /Version\/[\d.]+.*Safari\//.test(userAgent) ? 'safari' : 'other';
}

export function detectBrowser(userAgent: string, maxTouchPoints = 0): { browser: HelpBrowser; os: HelpOs } {
  return { browser: detectBrowserName(userAgent), os: detectOs(userAgent, maxTouchPoints) };
}

function siteStep(browser: HelpBrowser, os: HelpOs): TranslationKey {
  if (browser === 'samsung') return 'help.site.samsung';
  if (os === 'ios') {
    // Every iOS browser is WebKit, but only these two have known steps.
    if (browser === 'safari') return 'help.site.safariIos';
    return browser === 'chrome' ? 'help.site.chromeIos' : 'help.site.other';
  }
  const chromium = browser === 'chrome' || browser === 'edge';
  if (os === 'android') {
    if (chromium) return 'help.site.chromeAndroid';
    return browser === 'firefox' ? 'help.site.firefoxAndroid' : 'help.site.other';
  }
  if (chromium) return 'help.site.chromeDesktop';
  if (browser === 'safari') return 'help.site.safariDesktop';
  return browser === 'firefox' ? 'help.site.firefoxDesktop' : 'help.site.other';
}

const DEVICE_STEPS: Record<HelpOs, TranslationKey | null> = {
  ios: 'help.device.ios',
  android: 'help.device.android',
  mac: 'help.device.mac',
  windows: 'help.device.windows',
  other: null,
};

export interface LocationHelp {
  browser: HelpBrowser;
  os: HelpOs;
  /** Step 1: allow location for this site in the browser. */
  site: TranslationKey;
  /** Step 2: allow location for the browser on the device. Null when the system is unknown. */
  device: TranslationKey | null;
  /** The numbered steps in order: one or two. */
  steps: TranslationKey[];
}

/** How to turn location back on after it was refused, for this browser and system. */
export function locationHelp(userAgent: string, maxTouchPoints = 0): LocationHelp {
  const { browser, os } = detectBrowser(userAgent, maxTouchPoints);
  const site = siteStep(browser, os);
  const device = DEVICE_STEPS[os];
  return { browser, os, site, device, steps: device ? [site, device] : [site] };
}
