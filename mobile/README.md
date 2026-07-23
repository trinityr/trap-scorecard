# Trap Stats — mobile app shell (Capacitor)

This wraps the existing web app (`backend/public`) in a native Android/iOS
shell via [Capacitor](https://capacitorjs.com/), so it can be built,
signed, and submitted to the Play Store / App Store.

`capacitor.config.json` already points `webDir` at `../backend/public` —
Capacitor copies that folder's contents into the native project as-is, no
separate frontend build step needed.

## One-time setup (run this yourself — see note below)

```
cd mobile
npm install
npx cap add android   # generates the android/ native project
npx cap add ios        # generates the ios/ native project (macOS + Xcode only)
```

> **Note:** the `android/` folder in this repo right now is an incomplete,
> broken scaffold — a filesystem quirk on the machine that first ran
> `cap add android` here left some generated files stuck in a bad state
> partway through. Delete the whole `mobile/android` folder before running
> `npx cap add android` yourself; it'll regenerate cleanly.

Building requires tooling this repo doesn't bundle:
- **Android**: [Android Studio](https://developer.android.com/studio) (includes the SDK), a Google Play Console developer account ($25 one-time) to publish.
- **iOS**: a Mac with Xcode, an Apple Developer Program account ($99/year) to publish.

## Every time you change the web app

Whenever `backend/public` changes, re-copy it into the native projects and
rebuild:

```
cd mobile
npx cap sync
```

Then open and build/run from the native IDE:

```
npx cap open android   # opens Android Studio
npx cap open ios       # opens Xcode
```

## App identity

- **App ID**: `com.trapstats.app` (set in `capacitor.config.json`) — this
  is permanent once published to either store, so double-check it's what
  you want before your first release build. Reverse-DNS convention, doesn't
  need to match a real domain you own.
- **App name**: `Trap Stats`
- **Icons/splash**: Capacitor's asset pipeline
  (`@capacitor/assets`, not yet installed here) can generate all the
  required icon/splash sizes from a single source image — worth adding
  once you're ready to brand the native build using the same clay-pigeon
  mark already used for the web favicon (`backend/public/mark-*.svg`
  equivalents).

## Camera

The "Read Scoresheet" upload input uses a plain
`<input type="file" accept="image/*" capture="environment">`. Both
Android's system WebView and iOS's WKWebView (what Capacitor wraps) honor
`capture` by launching the actual camera app directly, no plugin bridge
needed — so the same file input works identically whether the page is
running as a desktop browser tab, an installed PWA, or inside this native
shell. `@capacitor/camera` isn't installed — it'd give more control (e.g.
skipping the OS camera chrome, in-app preview UI) but using it from a
plain `<script>`-tag app like this one (no bundler) needs an import-map or
bundling step that isn't set up yet. Add it later if the plain file-input
capture ever feels limiting.
