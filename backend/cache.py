"""HTTP caching policy for static front-end resources."""

from __future__ import annotations

from fastapi import FastAPI, Request
from starlette.responses import Response


def install_static_cache_policy(app: FastAPI) -> None:
    """Cache fingerprinted assets while keeping HTML/config fresh."""

    @app.middleware("http")
    async def static_cache_headers(
        request: Request,
        call_next,
    ) -> Response:
        response = await call_next(request)
        if request.method != "GET" or response.status_code not in {200, 206}:
            return response

        path = request.url.path
        if path.startswith("/api/"):
            return response
        if path in {"/", "/index.html", "/musics.html", "/config.js"}:
            response.headers["Cache-Control"] = "no-cache"
        elif path.startswith("/assets/") or request.url.query:
            response.headers["Cache-Control"] = (
                "public, max-age=604800, immutable"
            )
        elif path.endswith((".css", ".js")):
            response.headers["Cache-Control"] = "public, max-age=300"
        return response

