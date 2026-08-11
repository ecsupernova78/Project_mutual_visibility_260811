# Backend workspace

This directory owns the future FastAPI service and the reusable Astropy-based calculation layer.

The base dependency set is intentionally small. Catalog access (`astroquery`) and historical plotting/video dependencies are isolated in optional dependency groups so they do not automatically enlarge the production runtime.

```powershell
uv sync
uv sync --group catalog
uv sync --group research
```

No API endpoint or calculation module has been created yet.
