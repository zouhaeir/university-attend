# University Attendance Management System (UAMS)

A role-based university attendance management web application built with **HTML5**, **CSS3**, **Vanilla JavaScript (ES6+ Modules)**, **Firebase Authentication (Google Sign-In)**, **Cloud Firestore**, and **SheetJS (`xlsx`)**, ready for static hosting on **GitHub Pages**.

---

## Project Structure

```text
attendance-system/
├── index.html              # Public Google Sign-In login portal
├── teacher.html            # Teacher dashboard (profile, KPIs, assigned roster)
├── attendance.html         # Daily student attendance checklist (auto-save)
├── history.html            # Previous attendance history & audit-traced editing
├── admin.html              # Administrator console & SheetJS Excel import/export
├── firestore.rules         # Production Firestore Security Rules (RBAC + validation)
├── firebase.json           # Firebase CLI rules configuration
├── css/
│   ├── style.css           # Design tokens, typography, reusable UI components
│   ├── dashboard.css       # App shell, sidebar, topbar, stat grids, checklist styles
│   └── responsive.css      # Tablet & mobile breakpoints
├── js/
│   ├── firebase-config.js  # Single centralized Firebase initialization
│   ├── db.js               # Centralized Firestore database service
│   ├── auth.js             # Google authentication, UID binding & route guards
│   ├── teacher.js          # Teacher dashboard controller
│   ├── attendance.js       # Daily attendance checklist controller
│   ├── history.js          # Attendance history & edit controller
│   ├── admin.js            # Administrator dashboard & SheetJS Excel workflows
│   └── utils.js            # Local timezone dates, deterministic IDs, sanitization
└── assets/
    └── images/
```

---

## Phase 9 — Deploying Firestore Security Rules

1. Open the **Firebase Console** -> **Build > Firestore Database > Rules**.
2. Copy the entire contents of `firestore.rules` into the editor and click **Publish**.
3. *(Alternative via Firebase CLI)*:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase init firestore   # Select your project and keep firestore.rules
   firebase deploy --only firestore:rules
   ```

---

## Phase 10 — QA Integration & Verification Report

| Area | Verification Result | Implementation Details |
| :--- | :--- | :--- |
| **Centralized Firebase Init** | Passed | `initializeApp()` runs exclusively in `js/firebase-config.js`; all modules import `auth` and `db`. |
| **ES6 Module Paths** | Passed | All HTML and JS imports use relative paths (`./css/...`, `./js/...`) compatible with GitHub Pages project subpaths. |
| **Timezone Consistency** | Passed | `getLocalDateString()` in `js/utils.js` uses local `getFullYear()`, `getMonth()`, and `getDate()` instead of UTC `toISOString()`. |
| **Duplicate Prevention** | Passed | Daily attendance uses deterministic IDs `attendance/{YYYY-MM-DD}_{studentId}` written via `setDoc(..., { merge: true })`. |
| **Audit Trail** | Passed | Every checklist mark and history edit writes `updatedAt: serverTimestamp()`, `updatedBy` (Auth UID), `updatedByName`, and `updatedByEmail`. |
| **Pre-Imported Teacher UID Binding** | Passed | Teachers imported via Excel (`uid: null`) automatically bind to `teachers/{auth.uid}` and link their students on first Google Sign-In. |
| **RBAC Security** | Passed | Enforced server-side in `firestore.rules` (active staff check, role separation, teacher-student ownership check, status enum validation). |
| **Mobile Responsiveness** | Passed | Collapsible slide-over sidebar drawer and responsive stat/table breakpoints at `1140px`, `900px`, and `600px`. |

---

## Phase 11 — GitHub Pages Deployment Guide

### Step 1: Configure Firebase Credentials
1. Open `js/firebase-config.js` and replace the `YOUR_*` placeholders with your Firebase Web App config values from **Firebase Console > Project Settings > Your apps**.
2. Ensure no private Admin SDK service account JSON files are ever placed in this repository.

### Step 2: Configure Firebase Authentication
1. In **Firebase Console > Authentication > Sign-in method**, enable **Google** and set a Project support email.
2. Go to **Authentication > Settings > Authorized domains** and click **Add domain**.
3. Add your GitHub Pages domain:
   - `<your-github-username>.github.io` (for example, `mohammed-bamoamen.github.io`)

### Step 3: Seed Your Initial Administrator Account
1. In **Firestore Database > Data**, create a collection named `teachers`.
2. Add a document (e.g., ID `ADMIN-001`) with:
   - `uid`: `null`
   - `employeeId`: `"ADMIN-001"`
   - `name`: `"Your Name"`
   - `email`: `"your.google.account@gmail.com"` *(lowercase)*
   - `role`: `"admin"`
   - `department`: `"Administration"`
   - `active`: `true`
3. Publish `firestore.rules` in **Firestore Database > Rules**.

### Step 4: Upload to GitHub & Enable GitHub Pages
1. Create a new repository on GitHub (e.g., `university-attendance-system`).
2. Push the contents of the `attendance-system/` folder to the `main` branch:
   ```bash
   cd attendance-system
   git init
   git add .
   git commit -m "Deploy University Attendance Management System"
   git branch -M main
   git remote add origin https://github.com/<your-username>/university-attendance-system.git
   git push -u origin main
   ```
3. In your GitHub repository, open **Settings > Pages**.
4. Under **Build and deployment > Source**, choose **Deploy from a branch**.
5. Select branch **`main`** and folder **`/ (root)`**, then click **Save**.
6. Wait ~1–2 minutes and open `https://<your-username>.github.io/university-attendance-system/`.

### Step 5: Post-Deployment Verification Checklist
- [ ] Sign in at `index.html` with your seeded Admin Google account -> redirects to `admin.html`.
- [ ] Import sample Teachers and Students `.xlsx` files via **Excel Import / Export** -> preview validates rows and saves to Firestore.
- [ ] Export a Daily Attendance `.xlsx` report -> downloads properly formatted spreadsheet.
- [ ] Sign out and sign in with a registered Teacher Google account -> redirects to `teacher.html`.
- [ ] Open `attendance.html`, mark Present/Absent/Excused checkboxes -> `Saved` badge confirms write, and refreshing preserves selections.
- [ ] Open `history.html`, edit a previous day's status -> `Last Modified` updates with timestamp and editor attribution.
- [ ] Attempt to open `admin.html` while signed in as a Teacher -> automatically redirected back to `teacher.html`.
