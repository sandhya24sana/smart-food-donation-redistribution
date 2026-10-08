# Smart Food Donation and Redistribution System

A food redistribution platform connecting donors, receivers, NGOs, and volunteers through persistent donation, request, and delivery workflows. The app includes a React + TypeScript frontend and a Flask API backed by a local JSON data store.

## Stack

- Frontend: React, TypeScript, Vite, Tailwind CSS, Lucide React
- Backend: Python Flask
- Database: local JSON data store; PostgreSQL schema for migration reference
- Storage: local uploads

## Project structure

- `frontend/` – Vite React app
- `backend/` – Flask API service
- `database/` – PostgreSQL schema file
- `requirements.txt` – Python dependencies

## Prerequisites

- Node.js 18+
- Python 3.11+
- npm
- pip

## Setup

1. Create a virtual environment:

```bash
python -m venv .venv
```

2. Activate the environment:

Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

3. Install Python dependencies:

```bash
pip install -r requirements.txt
```

4. Install frontend dependencies:

```bash
cd frontend
npm install
```

The Flask backend stores application records in `backend/data/app_data.json`; a fresh local installation starts with an empty data store. No sample accounts, demo records, or demo credentials are seeded automatically. Create an account through the existing Sign Up flow before logging in. No API key or environment file is required.

## Run the app

Start the backend server (Windows PowerShell):

```powershell
python backend/app.py
```

Start the frontend app:

```bash
cd frontend
npm run dev -- --host 0.0.0.0
```

Open: http://localhost:5173

## Account registration

Select Donor, Receiver, NGO / Organization, or Volunteer on the first page, choose **Continue**, and create an account with a new email and password. The selected role is carried to login, so there is no second role-selection step. Sign Up stores the account and immediately creates a session; subsequent logins require the same email, password, and role. The four dashboards use the same saved donation, request, delivery, contribution, notification, feedback, and certificate records.

Public browsing is available without signing in at `/home`, `/browse`, and `/dashboard`. These views expose active food listing details and active community needs, while donation images are served through the existing public uploads route. Anonymous API responses omit donor contact and ownership data. Creating or changing records, responding to food, viewing personal dashboards, and other user-specific operations still require authentication; action links return to the requested dashboard after login.

## Database schema

`database/schema.sql` is retained as a PostgreSQL migration reference, not the active database. The running application uses its local JSON data store; the recovered Flask API reads and writes linked profiles, donations, requests, contributions, delivery tasks, volunteer availability, notifications, feedback, and certificates there. No external database credentials or API keys are required.

## Food image matching

When a donor enters a food name, the Donate Food form requests a matching image through Flask's `/api/food-image?food_name=...` endpoint using that exact name plus `food`, then retries with `drink`, `beverage`, or a glass-of-item query when needed. The backend searches Wikimedia Commons, ranks only exact-name title matches, and rejects generic artwork, preparation, packaging, and venue results. Lookups are debounced and successful results are cached to avoid repeated provider requests. If no exact result is available, the existing placeholder is shown; donation creation and editing still work with an empty image URL. Donor-uploaded photos remain the highest priority. Wikimedia Commons requires no API key.

Donor-uploaded food photos are saved by the Flask backend in `backend/uploads` (or the directory configured by `UPLOAD_FOLDER`). Relative `UPLOAD_FOLDER` values are resolved from the project root so the same saved files are served after restarting the backend from a different working directory. The donation record stores the returned `/uploads/...` path, allowing its photo to remain available when the donation is edited or viewed again.

The donor dashboard manages food listings, incoming requests, contribution coordination, donation history, and certificates. The receiver dashboard browses and requests donations. The NGO dashboard coordinates needs, requests, and deliveries. The volunteer dashboard manages delivery tasks, route/status updates, availability, and impact activity.

Delivery feedback is one record in the `delivery_feedback` collection in `backend/data/app_data.json`, keyed to its delivered task and linked donation/request. Only the owning receiver may submit or edit it. Donor and coordinating NGO dashboards retrieve the same record through their existing donation and delivery-task APIs; feedback notifications go only to those two related roles. JSON writes replace the store atomically so concurrent reads do not see a partially written file.

Delivery issues are stored once in the `delivery_issues` collection and remain linked by stable IDs to their reporter, donation, request, delivery, and coordinating NGO. Donors can report issues for their own delivered donations and view only issues they reported; receivers can reopen their issue details from request history. The coordinating NGO updates the same issue through Open -> Under Review -> Resolved and can save a resolution note. A donation is completed only after its full recorded quantity has been delivered and its active allocations are settled. Per-donation certificates and milestones use those verified completed records; older certificate records are retained but are not presented for donations that fail the completion check.

## Notes

- Donate Food image lookup uses Wikimedia Commons and requires no API key.
- Fresh local installs start with an empty data store; local file uploads are used when cloud storage is not configured.
- The database schema is included as a reference for a future PostgreSQL migration.
