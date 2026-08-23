/**
 * Ambient shims for browser-only globals referenced inside Playwright
 * `page.evaluate()` callbacks in Infinity routes (accessibility, compatibility,
 * performance). Those callbacks execute in the browser, but the server
 * tsconfig uses the `es2022` lib without DOM types, so declare the few
 * globals we touch as `any` to keep the server bundle type-clean.
 */
declare const window: any;
declare const document: any;
