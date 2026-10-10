# CardioGuard frontend

A React + Vite frontend scaffold based on the supplied 8-page frontend specification.

## Run it

1. Install Node.js (LTS).
2. Extract this folder and open it in VS Code.
3. Copy `.env.example` to `.env` and set `VITE_EDGE_URL` to your edge-device API URL.
4. In the project folder, run:

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

## Included screens

- Role-aware sign in / demo registration (Patient and Doctor)
- Edge-device health check / offline state
- Home dashboard and live capture (20-second countdown)
- ECG stream visualisation, SpO₂ gauge/trend, AI prediction
- Analysis records list and individual record details
- Doctor true-label form (F/N/Q/S/V)
- Local model training and aggregate/federated weights actions
- Responsive navigation drawer

## API endpoints used

- `GET /` — edge health check
- `GET /predict` — capture and infer (long timeout)
- `GET /data` — all records
- `PUT /true-label-update/{id}?true_label={0..4}` — doctor label
- `GET /local-train` — local training
- `POST /aggregate-weights` — submit/aggregate weights

## Authentication note — important

The supplied PDF describes a hard-coded, client-side login as a UI gate and explicitly warns that it is **not real security**. This scaffold therefore includes a demo role-based sign-in flow to help you develop the interface, but it is not production authentication. Do not use it to protect real patient information. Before deployment, implement server-side authentication (hashed passwords, secure HttpOnly session cookies or an appropriate identity provider), authorization checks on every API endpoint, HTTPS, and audit logging. Registration in this demo is stored only in browser session state and is not persisted to a database.

## Medical display note

The SpO₂ bands and model labels are informational display aids, not a diagnosis. The API's prediction is for the first ECG window only, as specified in the supplied document. Heart rate is shown as unavailable until a sampling rate and reliable R-peak detection are provided.
