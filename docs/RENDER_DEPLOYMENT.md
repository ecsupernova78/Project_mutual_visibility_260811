# Free public deployment on Render

This repository deploys as one Render Blueprint with two free services:

- `mutual-visibility-260811`: the React/Vite static site
- `mutual-visibility-api-260811`: the FastAPI web service

Both services are defined in the root `render.yaml`. Render waits for the
GitHub Actions checks to pass before deploying a new commit from `main`.

## First deployment

1. Push the deployment commit to the GitHub `main` branch.
2. Sign in to Render and choose **New > Blueprint**.
3. Connect `ecsupernova78/Project_mutual_visibility_260811`.
4. Keep the Blueprint path as `render.yaml` and create the two resources.
5. Confirm that both resources use the Free plan.
6. Wait for the GitHub Actions checks and both Render deploys to finish.
7. Open `https://mutual-visibility-260811.onrender.com`.

No secret environment variables are required. The frontend API URL and the
backend CORS allow-list are declared in `render.yaml`.

## Normal updates

Push a commit to `main`. GitHub Actions runs the backend and frontend checks.
Render deploys only after those checks pass. No local development server needs
to remain running.

## Free-service wake-up behavior

The static site remains available. After 15 minutes without inbound traffic,
Render can spin down the free FastAPI service. The frontend probes `/health`
and waits for the API to wake before it sends a calculation or catalog request.
The first operation after an idle period can therefore take about one minute.

Catalog responses are held only in process memory for a short TTL. They are a
performance cache, not permanent user data. Losing this cache on a restart or
spin-down does not lose observing sites or selected targets: observing-site
profiles are stored in each visitor's browser, and catalog results can be
queried from the upstream TAP services again.

## Verification

- Static site: `https://mutual-visibility-260811.onrender.com`
- API health: `https://mutual-visibility-api-260811.onrender.com/health`
- API documentation: `https://mutual-visibility-api-260811.onrender.com/docs`

If Render reports that a service name is already taken, choose a new static
site name and update both `VITE_API_BASE_URL`/`CORS_ORIGINS` as appropriate
before syncing the Blueprint again.
