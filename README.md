# RFID Kiosk Demo

This is a small demo project that implements:
- Admin login and user upload (with face image)
- QR code generation for each user
- Kiosk frontend that scans QR codes and fetches user data to display

Quick start

1. Install dependencies

```bash
npm install
```

2. Start the server

```bash
npm start
```

3. Open the admin UI to create users:

http://localhost:3000/admin

Login (demo credentials): `admin` / `password123`

4. Open the kiosk UI on the same host/machine:

http://localhost:3000/
(or http://localhost:3000/kiosk)

Notes
- QR codes encode the URL to `/api/users/:id`. The kiosk reads the URL and fetches the user data.
- This is a demo scaffold. For production you must secure sessions, use HTTPS, and validate inputs.

Attendance

- The kiosk will POST to `/api/attendance/mark` when a QR is scanned to record attendance for the current date.
- The kiosk also supports continuous camera matching against enrolled face images and reference image uploads for attendance verification.
- Admin can view reports at the Admin UI under "Attendance Reports". Select a date and click "Load Report" to see Present/Absent lists grouped by section.
- You can download the report as CSV, XLSX, or PDF using the buttons.

