"""PGENRO IMS deployment entry point.

Serves the existing frontend and exposes the Python/Tesseract OCR API from one
Flask application.  The static-file resolver is intentionally tolerant of old
bookmarks and Windows-style case differences so Render/Linux does not return a
404 just because a legacy link used ``/user`` instead of ``/User`` or used a
different filename case.
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
STATIC_ROOTS_BY_CASEFOLD = {name.casefold(): name for name in STATIC_ROOTS}
STATIC_EXTENSIONS = {
    ".html", ".css", ".js", ".json", ".png", ".jpg", ".jpeg", ".gif",
    ".webp", ".svg", ".ico", ".txt", ".map", ".woff", ".woff2", ".ttf",
}

# Friendly and legacy URLs that may already be bookmarked or present in older
# builds.  Values are canonical paths relative to the repository root.
ROUTE_ALIASES = {
    "": "User/login.html",
    "index.html": "User/login.html",
    "login": "User/login.html",
    "login.html": "User/login.html",
    "user": "User/homepage.html",
    "user/": "User/homepage.html",
    "user/login": "User/login.html",
    "user/home": "User/homepage.html",
    "user/homepage": "User/homepage.html",
    "user/travelor": "User/travelOR.html",
    "user/visitors": "User/visitorsView.html",
    "admin": "admin/admin.html",
    "admin/": "admin/admin.html",
    "admin/dashboard": "admin/admin.html",
    "admin/travelor": "admin/travelOR-admin.html",
    "admin/travelorder": "admin/travelOR-admin.html",
    "admin/inventory": "admin/invetoryadmin.html",
    "admin/inventoryadmin.html": "admin/invetoryadmin.html",
    "admin/usermanagement": "admin/Usermanagement.html",
    "settings": "SettingIMS/Settings.html",
}


def _canonical_alias(asset_path: str) -> str | None:
    """Return a canonical route for known extensionless/legacy aliases."""
    clean = asset_path.strip().lstrip("/")
    key = clean.casefold()
    direct = {k.casefold(): v for k, v in ROUTE_ALIASES.items()}.get(key)
    if direct:
        return direct

    # Legacy spelling/case aliases that include .html.
    html_aliases = {
        "user/travelor.html": "User/travelOR.html",
        "user/visitorsview.html": "User/visitorsView.html",
        "admin/travelor-admin.html": "admin/travelOR-admin.html",
        "admin/usermanagement.html": "admin/Usermanagement.html",
        "admin/inventoryadmin.html": "admin/invetoryadmin.html",
        "settingims/settings.html": "SettingIMS/Settings.html",
        "visitorslog/visitorslogin.html": "VisitorsLog/visitorsLogin.html",
    }
    return html_aliases.get(key)


def _resolve_case_insensitive(asset_path: str) -> Path | None:
    """Resolve a browser asset without trusting path traversal or URL casing."""
    requested = Path(asset_path.strip().lstrip("/"))
    parts = requested.parts
    if not parts or any(part in {"", ".", ".."} or part.startswith(".") for part in parts):
        return None

    root_name = STATIC_ROOTS_BY_CASEFOLD.get(parts[0].casefold())
    if not root_name:
        return None

    current = ROOT / root_name
    for part in parts[1:]:
        exact = current / part
        if exact.exists():
            current = exact
            continue
        if not current.is_dir():
            return None
        match = next((child for child in current.iterdir() if child.name.casefold() == part.casefold()), None)
        if match is None:
            return None
        current = match

    try:
        current.resolve().relative_to(ROOT)
    except (ValueError, OSError):
        return None

    if not current.is_file() or current.suffix.lower() not in STATIC_EXTENSIONS:
        return None
    return current.resolve()


@app.get("/")
def pgenro_home():
    return redirect("/User/login.html", code=302)


@app.get("/index.html")
def pgenro_index():
    return redirect("/User/login.html", code=302)


@app.get("/<path:asset_path>")
def pgenro_static(asset_path: str):
    """Serve approved browser assets and absorb legacy URL case differences."""
    alias = _canonical_alias(asset_path)
    if alias:
        target = ROOT / alias
        if target.is_file():
            # For HTML aliases, redirect to one canonical URL so relative links,
            # browser history and bookmarks all become consistent.
            if target.suffix.lower() == ".html" and asset_path.lstrip("/") != alias:
                return redirect("/" + alias, code=302)
            return send_from_directory(target.parent, target.name)

    target = _resolve_case_insensitive(asset_path)
    if target is None:
        abort(404)

    canonical = target.relative_to(ROOT).as_posix()
    requested = asset_path.strip().lstrip("/")
    if target.suffix.lower() == ".html" and requested != canonical:
        return redirect("/" + canonical, code=302)

    return send_from_directory(target.parent, target.name)


@app.after_request
def pgenro_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    return response


if __name__ == "__main__":
    main()
