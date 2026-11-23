# University Attendance Management System (UAMS)

A role-based university attendance management web application built with **HTML5**, **CSS3**, **Vanilla JavaScript (ES6+ Modules)**, **Firebase Authentication (Google Sign-In)**, **Cloud Firestore**, and **SheetJS (`xlsx`)**, ready for static hosting on **GitHub Pages**.

### Step 5: Post-Deployment Verification Checklist
- [ ] Sign in at `index.html` with your seeded Admin Google account -> redirects to `admin.html`.
- [ ] Import sample Teachers and Students `.xlsx` files via **Excel Import / Export** -> preview validates rows and saves to Firestore.
- [ ] Export a Daily Attendance `.xlsx` report -> downloads properly formatted spreadsheet.
- [ ] Sign out and sign in with a registered Teacher Google account -> redirects to `teacher.html`.
- [ ] Open `attendance.html`, mark Present/Absent/Excused checkboxes -> `Saved` badge confirms write, and refreshing preserves selections.
- [ ] Open `history.html`, edit a previous day's status -> `Last Modified` updates with timestamp and editor attribution.
- [ ] Attempt to open `admin.html` while signed in as a Teacher -> automatically redirected back to `teacher.html`.
