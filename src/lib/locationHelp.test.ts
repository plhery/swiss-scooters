import { describe, expect, it } from 'vitest';
import { detectBrowser, locationHelp } from '@/lib/locationHelp';

// User agents as the browsers send them.
const UA = {
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  safariIpad: 'Mozilla/5.0 (iPad; CPU OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1',
  chromeIpadDesktopSite: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Version/17.5 Safari/605.1.15',
  firefoxIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
  edgeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/125.0.2535.96 Mobile/15E148 Safari/605.1.15',
  duckDuckGoIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 DuckDuckGo/7 Safari/605.1.15',
  googleAppIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/323.0.647062479 Mobile/15E148 Safari/604.1',
  instagramIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 338.0.0.24.92 (iPhone15,2; iOS 17_5_1; en_US; en; scale=3.00; 1179x2556; 613274212)',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  edgeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 EdgA/126.0.0.0',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0',
  samsungInternet: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  operaAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 OPR/83.0.0.0',
  androidWebView: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240605.024; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.134 Mobile Safari/537.36',
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  chromeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  chromeLinux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  chromeOs: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  edgeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  edgeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  firefoxWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
  operaWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 OPR/111.0.0.0',
};

describe('detectBrowser', () => {
  it.each([
    ['safariIphone', 'safari', 'ios'],
    ['safariIpad', 'safari', 'ios'],
    ['chromeIphone', 'chrome', 'ios'],
    ['firefoxIphone', 'firefox', 'ios'],
    ['edgeIphone', 'edge', 'ios'],
    ['duckDuckGoIphone', 'other', 'ios'],
    ['googleAppIphone', 'other', 'ios'],
    ['instagramIphone', 'other', 'ios'],
    ['chromeAndroid', 'chrome', 'android'],
    ['edgeAndroid', 'edge', 'android'],
    ['firefoxAndroid', 'firefox', 'android'],
    ['samsungInternet', 'samsung', 'android'],
    ['operaAndroid', 'other', 'android'],
    ['androidWebView', 'other', 'android'],
    ['chromeMac', 'chrome', 'mac'],
    ['chromeWindows', 'chrome', 'windows'],
    ['chromeLinux', 'chrome', 'other'],
    ['chromeOs', 'chrome', 'other'],
    ['edgeWindows', 'edge', 'windows'],
    ['edgeMac', 'edge', 'mac'],
    ['safariMac', 'safari', 'mac'],
    ['firefoxWindows', 'firefox', 'windows'],
    ['firefoxMac', 'firefox', 'mac'],
    ['firefoxLinux', 'firefox', 'other'],
    ['operaWindows', 'other', 'windows'],
  ] as const)('recognizes %s', (name, browser, os) => {
    expect(detectBrowser(UA[name])).toEqual({ browser, os });
  });

  it('recognizes an iPad that presents itself as a Mac by its touch screen', () => {
    expect(detectBrowser(UA.safariMac, 0)).toEqual({ browser: 'safari', os: 'mac' });
    expect(detectBrowser(UA.safariMac, 1)).toEqual({ browser: 'safari', os: 'mac' });
    expect(detectBrowser(UA.safariMac, 5)).toEqual({ browser: 'safari', os: 'ios' });
    expect(detectBrowser(UA.chromeIpadDesktopSite, 5)).toEqual({ browser: 'chrome', os: 'ios' });
  });

  it('does not mistake a touch-screen Windows laptop for anything else', () => {
    expect(detectBrowser(UA.chromeWindows, 10)).toEqual({ browser: 'chrome', os: 'windows' });
  });

  it('knows nothing about an empty or unfamiliar user agent', () => {
    expect(detectBrowser('')).toEqual({ browser: 'other', os: 'other' });
    expect(detectBrowser('curl/8.6.0')).toEqual({ browser: 'other', os: 'other' });
  });
});

describe('locationHelp', () => {
  it.each([
    ['safariIphone', 0, 'help.site.safariIos', 'help.device.ios'],
    ['safariIpad', 5, 'help.site.safariIos', 'help.device.ios'],
    ['safariMac', 5, 'help.site.safariIos', 'help.device.ios'],
    ['chromeIphone', 5, 'help.site.chromeIos', 'help.device.ios'],
    ['chromeIpadDesktopSite', 5, 'help.site.chromeIos', 'help.device.ios'],
    ['firefoxIphone', 5, 'help.site.other', 'help.device.ios'],
    ['edgeIphone', 5, 'help.site.other', 'help.device.ios'],
    ['instagramIphone', 5, 'help.site.other', 'help.device.ios'],
    ['chromeAndroid', 5, 'help.site.chromeAndroid', 'help.device.android'],
    ['edgeAndroid', 5, 'help.site.chromeAndroid', 'help.device.android'],
    ['firefoxAndroid', 5, 'help.site.firefoxAndroid', 'help.device.android'],
    ['samsungInternet', 5, 'help.site.samsung', 'help.device.android'],
    ['operaAndroid', 5, 'help.site.other', 'help.device.android'],
    ['androidWebView', 5, 'help.site.other', 'help.device.android'],
    ['chromeMac', 0, 'help.site.chromeDesktop', 'help.device.mac'],
    ['edgeMac', 0, 'help.site.chromeDesktop', 'help.device.mac'],
    ['chromeWindows', 0, 'help.site.chromeDesktop', 'help.device.windows'],
    ['edgeWindows', 10, 'help.site.chromeDesktop', 'help.device.windows'],
    ['safariMac', 0, 'help.site.safariDesktop', 'help.device.mac'],
    ['firefoxMac', 0, 'help.site.firefoxDesktop', 'help.device.mac'],
    ['firefoxWindows', 0, 'help.site.firefoxDesktop', 'help.device.windows'],
    ['operaWindows', 0, 'help.site.other', 'help.device.windows'],
  ] as const)('gives %s (%i touch points) both steps', (name, touchPoints, site, device) => {
    expect(locationHelp(UA[name], touchPoints)).toMatchObject({ site, device, steps: [site, device] });
  });

  it.each([
    ['chromeLinux', 'help.site.chromeDesktop'],
    ['chromeOs', 'help.site.chromeDesktop'],
    ['firefoxLinux', 'help.site.firefoxDesktop'],
  ] as const)('omits the device step for %s', (name, site) => {
    expect(locationHelp(UA[name])).toMatchObject({ site, device: null, steps: [site] });
  });

  it('falls back to the generic instruction alone for an unknown browser and system', () => {
    expect(locationHelp('')).toEqual({
      browser: 'other',
      os: 'other',
      site: 'help.site.other',
      device: null,
      steps: ['help.site.other'],
    });
  });
});
