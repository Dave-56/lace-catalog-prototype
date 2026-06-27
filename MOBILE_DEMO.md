# LACE iPhone Demo

LACE should stay as one responsive web app for this pass. There is no separate `mobile/` folder because the iPhone version shares the same HTML, API routes, and catalog flow.

## Demo Path

1. Deploy the Node app to an HTTPS host that supports long-running Node services.
2. Set `GEMINI_API_KEY` in the host environment.
3. Open the HTTPS URL in Safari on iPhone.
4. Use Share -> Add to Home Screen.
5. Launch LACE from the Home Screen and run: Take a pic -> crop -> Search -> Watch -> Orbit -> Alerts.

## Render Setup

This repo includes `render.yaml`.

- Build command: `npm install`
- Start command: `npm run start`
- Health check: `/health`
- Required env: `GEMINI_API_KEY`
- Optional env: `GEMINI_MODEL`

For a friend demo, keep the current seeded `data/orbit.json`. For real users, replace local JSON persistence with a hosted database.
