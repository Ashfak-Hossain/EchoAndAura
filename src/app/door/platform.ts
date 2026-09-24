/**
 * What kind of phone and browser the door page is in. Read on the client
 * only (through useSyncExternalStore, so the server render stays neutral).
 */

export function isIos(ua: string, maxTouchPoints: number): boolean {
  // iPadOS reports itself as a Mac; the touch screen gives it away.
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && maxTouchPoints > 1);
}

const IN_APP: { pattern: RegExp; name: string }[] = [
  { pattern: /FBAN|FBAV|FB_IAB|FBIOS|Messenger/i, name: 'Facebook' },
  { pattern: /Instagram/i, name: 'Instagram' },
  { pattern: /Line\//, name: 'LINE' },
  { pattern: /MicroMessenger/i, name: 'WeChat' },
  { pattern: /Snapchat/i, name: 'Snapchat' },
  { pattern: /musical_ly|BytedanceWebview|TikTok/i, name: 'TikTok' },
  { pattern: /Telegram/i, name: 'Telegram' },
];

/**
 * An app's built-in browser (Messenger, Instagram…): the camera is often
 * blocked there and cookies live in the app, so the door sends staff to
 * Safari or Chrome instead. Null in a real browser.
 */
export function inAppBrowser(ua: string): string | null {
  return IN_APP.find((b) => b.pattern.test(ua))?.name ?? null;
}

/** For useSyncExternalStore: these never change while the page is open. */
export const subscribeNever = () => () => {};
