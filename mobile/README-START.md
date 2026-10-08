# How to Run (Super Simple)

## Option A: One double-click (Windows) ⭐ EASIEST

1. Double-click **`START-HERE.bat`** (in the main project folder)
2. Wait ~1-2 minutes. A QR code will appear in the black window.
3. On your phone:
   - Connect Wi-Fi to the **same network** as your PC
   - Install **Expo Go** from Play Store
   - Open Expo Go → tap **Scan QR code** → scan the QR
4. App opens. Login:

   | Email | Password |
   |---|---|
   | `admin@company.com` | `change-this-password` |

**Keep the black window open while using the app.**

---

## Option B: Manual (if Option A fails)

### Step 1 — Start the server
Open Docker Desktop. Wait until it says "Running" (green).
Then open Command Prompt in the project folder and run:
```
docker compose up -d backend
```

### Step 2 — Load demo data (first time only)
```
docker compose exec backend python seed.py
```

### Step 3 — Check the server works
Open browser → `http://localhost:8010/docs`
You should see a page with API endpoints. ✅
(If localhost does not load, that's a Windows/Docker quirk — the phone
connection still works. The app uses your PC's network IP automatically.)

### Step 4 — Start the mobile app
```
cd mobile
npm install      (only first time)
npm start
```
QR code appears in the terminal.

### Step 5 — Phone
Same Wi-Fi as PC → Expo Go → Scan QR code → login.

---

## If something doesn't work

| Problem | Fix |
|---|---|
| "Docker is not running" | Open Docker Desktop, wait for green, try again |
| QR shows but app stuck on "Loading" | Phone & PC not on same Wi-Fi. Turn off phone mobile data. If on office Wi-Fi, use the **phone hotspot** fix above |
| PC IP changed (moved Wi-Fi) | Always rescan a **fresh** QR after any network change — old QRs point to the old IP |
| "Cannot reach server" in app | Office/company Wi-Fi usually **blocks phone→PC traffic**. Always-works fix: turn on your **phone hotspot**, connect the PC's Wi-Fi to the hotspot, rerun START-HERE.bat, rescan the QR |
| "Cannot connect to Expo CLI" warning in app | Same cause as above — old QR / network changed. Rescan a fresh QR (or use the phone-hotspot fix). If it persists, in the black Expo window press `s` and pick the LAN URL |
| Backend port | This project uses **8010** (8000 was taken by another project on this PC) |
| Login says wrong password | Run step 2 again (loads demo data) |
| White screen in Expo Go | In the black window press `r` to reload, or `npm start -- --clear` |
| Nothing helps | Restart PC, open Docker Desktop, double-click START-HERE.bat again |

---

## Stopping everything
Close the black window (Expo stops).
Then in Command Prompt: `docker compose stop`
