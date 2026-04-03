# Embedded MP4 Grabber

[![License: 0BSD](https://img.shields.io/badge/license-0BSD-17624a.svg)](./LICENSE)
[![Firefox](https://img.shields.io/badge/browser-Firefox-f08a24.svg)](https://www.mozilla.org/firefox/)
[![Manifest V3](https://img.shields.io/badge/webextension-MV3-1d2433.svg)](https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions)

A small Firefox extension that finds direct `.mp4` video files on the current page and downloads them so you can open them in VLC or any other player.

Firefox extension for grabbing direct embedded MP4 URLs from ordinary web pages so you can watch them in a desktop player instead of a cramped browser video widget.

## License

This project is licensed under the `0BSD` license, which is about as permissive as it gets for software reuse.

## What it does

- Scans the page for direct MP4 sources in `<video>`, `<source>`, links, and common `data-*` attributes.
- Watches real network responses for MP4 files, which helps when a custom player hides the URL in the DOM.
- Shows everything it found in the toolbar popup.
- Downloads one file at a time or all detected files at once.

## What it does not do

- It only targets direct MP4 files.
- It does not handle DRM, encrypted streams, `blob:` URLs, or segmented stream formats like HLS/DASH (`.m3u8`, `.mpd`).
- It is intentionally not built for large streaming sites or site-specific extraction logic.

## Load it in Firefox

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Choose `{repo-directory}/ff-video-download/manifest.json`
4. Visit a page with an embedded MP4 player
5. Click the extension button and press **Download**

## Next ideas

- Add filename rules based on page title
- Add a right-click download action for videos
- Add filtering so duplicate CDN variants are easier to sort through
