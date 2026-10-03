"""PGENRO IMS deployment entry point.

Serves the existing frontend and exposes the existing Python/Tesseract OCR API
from one Flask application so Render can deploy the whole system as one Docker
Web Service.
"""
from __future__ import annotations

from pathlib import Path

from flask import abort, redirect, send_from_directory

from User.OCR import app, main

ROOT = Path(__file__).resolve().parent
STATIC_ROOTS = {
    "User",
    "admin",
    "shared",
    "logo",
    "SettingIMS",
    "VisitorsLog",
    "account",
}
STATIC_EXTENSIONS = {
    ".html", ".css", ".js", ".json", ".png", ".jpg", ".jpeg", ".gif",
    ".webp", ".svg", ".ico", ".txt", ".map", ".woff", ".woff2", ".ttf",
}


@app.get("/")
def pgenro_home():
    return redirect("/User/login.html", code=302)


@app.get("/<path:asset_path>")
def pgenro_static(asset_path: str):
    """Serve only browser assets from approved application directories."""
    requested = Path(asset_path)
    if not requested.parts or requested.parts[0] not in STATIC_ROOTS:
        abort(404)
    if any(part.startswith(".") for part in requested.parts):
        abort(404)
    if requested.suffix.lower() not in STATIC_EXTENSIONS:
        abort(404)

    target = (ROOT / requested).resolve()
    try:
        target.relative_to(ROOT)
    except ValueError:
        abort(404)
    if not target.is_file():
        abort(404)

    return send_from_directory(target.parent, target.name)


@app.after_request
def pgenro_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    return response


if __name__ == "__main__":
    main()
