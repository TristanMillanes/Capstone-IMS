Firebase Realtime Database — Visitors Log Setup

Quick steps

1. Open your Firebase console and select the project (e.g., `ims-capstone-bc65f`).
2. In the left menu choose **Realtime Database** → **Create database**. Choose a region matching your `databaseURL` (e.g., asia-southeast1).
3. Start in **locked mode** for production. For quick testing you can temporarily set rules to open (see below) but secure your DB before going live.
4. Ensure your pages include the Firebase SDK scripts before any initializer script:

```html
<script src="https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.22.2/firebase-database-compat.js"></script>
<script src="/VisitorsLog/visitorsData.js"></script> <!-- contains firebaseConfig and init -->
```

5. The project already has `visitorsData.js` with `firebaseConfig`. Confirm its `databaseURL` matches the DB you created.

Development rules (temporary)

Use these rules only for quick local testing. They allow read/write without auth and are NOT safe for production:

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

Recommended production rules

Require authentication and validate payloads. Example (basic authenticated access):

```json
{
  "rules": {
    "visitors": {
      ".read": "auth != null",
      ".write": "auth != null"
    }
  }
}
```

Tips

- Use the Firebase console Data view to inspect the `visitors` node and monitor incoming pushes.
- If visitors are not showing in `visitorsView.html`, open the browser console to check for `Realtime DB` initialization logs or errors.
- For more advanced validation, add rules that validate required fields and types.

If you want, I can also add server-side validation, authentication hooks, or move the `firebaseConfig` into a central `User/firebase-config.js` file.
