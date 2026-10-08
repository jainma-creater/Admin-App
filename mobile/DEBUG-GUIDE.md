# Mobile Debug & Run Guide (Expo Go on Android)

Why the app showed a **white screen** and how every cause was fixed, plus how to
run it on your phone and debug future issues.

---

## 1. What caused the white screen (and what was fixed)

| # | Cause | Symptom | Fix |
|---|-------|---------|-----|
| 1 | **`(auth)/_layout.tsx` returned `<></>`** — an expo-router group layout must render a navigator. The login screen rendered *nothing*. | White screen instantly on launch | Now renders a `<Stack>` with the login screen |
| 2 | **Broken relative imports** — `(app)/_layout.tsx` imported `../../../stores/auth` and `actions/index.tsx` imported `../../lib/api` (one `../` too deep). Metro could not resolve them and threw `Unable to resolve module` | White screen / red box on any authenticated navigation | Corrected to `../../stores/auth` and `../../../lib/api` |
| 3 | **Root layout unmounted the active navigator on auth change** (`{user ? <A/> : <B/>}` inside `<Stack>`) — during the swap there is *nothing to render* | White flash / permanent blank after login or logout | Auth redirect is now imperative via an `AuthGate` component; both groups stay mounted |
| 4 | **`isLoading` never reset** in the auth store when no cached session existed → the boot gate spun forever | Stuck on splash/loading forever | `loadSession()` always ends in `set({ isLoading: false })` |
| 5 | **Hardcoded API URL `http://10.0.2.2:8000`** — only valid for Android *emulators*. On a real phone every request failed | Endless spinner on login, "no internet" feel | Base URL auto-derives from Metro's host (`Constants.expoConfig.hostUri`), overridable via `EXPO_PUBLIC_API_URL` |
| 6 | **Camera screen called `Camera.requestPermissionsAsync()`** — removed in expo-camera 16+ (SDK 52+). Threw a TypeError on screen load | Crash when opening the camera | Uses the `useCameraPermissions()` hook with a proper permission UI; camera is guarded on web |
| 7 | **Checklist screen had a broken nested `FlatList`** — items were rendered inside `ListHeaderComponent` of a `FlatList` whose `data` was filtered down to nothing | Blank body under the progress bar | Single clean `FlatList` of items + error/retry states |
| 8 | **Wrong HTTP verbs in offline sync** — `PATCH /visits/{id}/start` and `/submit` (backend declares `POST`); sync also selected only SUBMITTED+ visits (which are server-managed) so it never synced anything | Silent sync failures | `POST` for `/start`, correct status filter (DRAFT…IN_PROGRESS), table allowlist in `markSynced` |
| 9 | **Stale `node_modules` (SDK 52) vs `package.json` (SDK 57)** — expo-router 4 with React 18 while the code uses SDK 57/React 19 APIs | Runtime API mismatches, missing type declarations | Reinstalled cleanly: expo 57.0.23, expo-router 57.0.21, react-native 0.86.3, react 19.2.3 |
| 10 | **Refresh interceptor logged the user out on any network error** — a dropped packet cleared the token store | Random logouts, blank state on flaky Wi-Fi | Only a *server-rejected* refresh (401/403) clears tokens now |

Also added: an error boundary that wraps navigation from the *first* render (errors now show text instead of a silent white screen), `[api] Base URL` logging in Metro, retry buttons on failed queries, and a boot screen that surfaces offline-storage warnings.

---

## 2. Run it on your phone (step by step)

1. **Start the backend on your LAN** (not just localhost):
   ```bash
   docker compose up -d backend      # published on host port 8010
   docker compose exec backend python seed.py   # first time only
   ```
   Or without Docker:
   ```bash
   cd backend
   uvicorn app.main:app --host 0.0.0.0 --port 8010
   ```
   Verify from another device: `http://<YOUR-PC-IP>:8010/docs`

2. **Start Metro**:
   ```bash
   cd mobile
   npm install        # once, after pulling
   npm start
   ```

3. **Connect from the phone**:
   - Phone and PC on the **same Wi-Fi**
   - Install **Expo Go** from the Play Store
   - Scan the QR code from the terminal (Android: "Scan QR code" button inside Expo Go)

4. **Log in** with `admin@company.com` / `change-this-password` (see README).

> **Windows Firewall note:** the first run may prompt to allow Node/Python on
> private networks — click Allow, or inbound connections from the phone will fail.

### If auto-detection doesn't work
Pin the API location explicitly — create `mobile/.env`:
```
EXPO_PUBLIC_API_URL=http://192.168.1.20:8010/api/v1
```
(Use *your* IPv4 from `ipconfig`; this project publishes the backend on **8010**.)
Restart Metro with `npm start -- --clear`.

---

## 3. Debugging workflow (when something looks wrong)

- **Metro terminal** — JS `console.log`s appear here, including
  `[api] Base URL: …`. That single line tells you where the app is trying to
  connect; it must be your PC's LAN IP, not `10.0.2.2`.
- **Red box / error boundary** — errors now render on-screen with the message
  instead of a white screen. Read the first line; it names the failing module.
- **In-app network errors** — messages now include the base URL, e.g.
  *"Cannot reach the server at http://192.168.1.20:8000/api/v1. Check that the
  backend is running and your phone is on the same Wi-Fi network."*
  - `10.0.2.2` in the URL ⇒ Metro info missing (prod-style launch) — set
    `EXPO_PUBLIC_API_URL`.
  - Correct IP but still failing ⇒ firewall or backend not listening on 0.0.0.0.
  - On Windows, `localhost:8010` may stall even when the server is fine —
    always test with the PC's LAN IP, which is what the phone uses anyway.
- **Reload the app** — shake the phone (or press `r` in the Metro terminal) to
  reload the JS bundle after code changes.
- **Clear caches** when things get weird:
  ```bash
  npm start -- --clear        # Metro transform cache
  ```
  Or from Android system settings: Expo Go → Storage → Clear data.
- **Deep check without a phone** (validates the whole bundle):
  ```bash
  node node_modules/expo/bin/cli export --platform android --output-dir .expo-out
  ```
  A clean export = no unresolved imports, no syntax errors.

### Quick sanity checks
| Check | Command / action | Expected |
|---|---|---|
| Backend up | open `http://<PC-IP>:8010/docs` on the phone's browser | Swagger page loads |
| Metro reachable | `adb reverse tcp:8081 tcp:8081` (emulator) or QR scan | App loads in Expo Go |
| API base | first Metro log line | `[api] Base URL: http://<PC-IP>:8010/api/v1` |
| Types | `node node_modules/typescript/bin/tsc --noEmit` | no output, exit 0 |

---

## 4. Notes for building beyond Expo Go

`npx expo run:android` (a real dev build) needs Android Studio/SDK + JDK 17 and
compiles native code — much slower than Expo Go, so only do it when adding a
library with native code that Expo Go can't serve. The Expo Go workflow above
is the fastest path for daily development.
