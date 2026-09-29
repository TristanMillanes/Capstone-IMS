from collections import Counter
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess


ROOT = Path(__file__).resolve().parents[1]
ISSUES = []
INLINE_SCRIPT_COUNT = 0
OBSOLETE_CSS = {
    "admin-ui.css",
    "admin-modern.css",
    "visitors-admin-enhanced.css",
    "pgenro-global.css",
    "pgenro-user.css",
    "workspace.css",
    "repaired-ui.css",
    "ui-overrides.css",
}


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.refs = []
        self.inline_scripts = []
        self.stylesheets = []
        self._script = None

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if "id" in attributes:
            self.ids.append(attributes["id"])

        if tag in {"a", "script", "link", "img"}:
            self.refs.append((tag, attributes.get("src", attributes.get("href", ""))))

        if tag == "link" and "stylesheet" in attributes.get("rel", "").lower():
            self.stylesheets.append(attributes.get("href", ""))

        if tag == "script" and not attributes.get("src"):
            self._script = ""

    def handle_data(self, data):
        if self._script is not None:
            self._script += data

    def handle_endtag(self, tag):
        if tag == "script" and self._script is not None:
            self.inline_scripts.append(self._script)
            self._script = None


def project_files(pattern):
    return [path for path in ROOT.rglob(pattern) if ".git" not in path.parts and "node_modules" not in path.parts]


def local_reference(reference):
    clean = reference.split("?", 1)[0].split("#", 1)[0]
    if not clean or clean.startswith(
        ("http", "data:", "mailto:", "tel:", "javascript:", "/")
    ):
        return None
    return clean


def check_javascript(source, label):
    result = subprocess.run(
        ["node", "--check"],
        input=source,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        ISSUES.append(f"{label}: {result.stderr.strip()}")


html_files = project_files("*.html")
for html_path in html_files:
    parser = Page()
    raw = html_path.read_text(encoding="utf-8")
    parser.feed(raw)

    if len(re.findall(r"<!doctype html>", raw, re.IGNORECASE)) != 1:
        ISSUES.append(f"{html_path}: invalid doctype count")

    for element_id, count in Counter(parser.ids).items():
        if count > 1:
            ISSUES.append(f"{html_path}: duplicate id {element_id}")

    for _, reference in parser.refs:
        local = local_reference(reference)
        if local and not (html_path.parent / local).exists():
            ISSUES.append(f"{html_path}: missing {local}")

    local_styles = [
        local_reference(reference)
        for reference in parser.stylesheets
        if local_reference(reference)
    ]
    if html_path.name != "index.html" and len(local_styles) != 2:
        ISSUES.append(
            f"{html_path}: expected module + category CSS, found {len(local_styles)}"
        )

    for script in parser.inline_scripts:
        if not script.strip():
            continue
        INLINE_SCRIPT_COUNT += 1
        check_javascript(script, str(html_path))

for javascript_path in project_files("*.js"):
    result = subprocess.run(
        ["node", "--check", str(javascript_path)],
        capture_output=True,
        text=True,
    )
    if result.returncode:
        ISSUES.append(result.stderr.strip())

css_files = project_files("*.css")
for css_path in css_files:
    if css_path.name in OBSOLETE_CSS:
        ISSUES.append(f"{css_path}: obsolete CSS layer still exists")
    if "SOURCE:" in css_path.read_text(encoding="utf-8"):
        ISSUES.append(f"{css_path}: still contains copied source layers")

result = {
    "html_pages": len(html_files),
    "javascript_files": len(project_files("*.js")),
    "inline_scripts": INLINE_SCRIPT_COUNT,
    "css_files": len(css_files),
    "css_bytes": sum(path.stat().st_size for path in css_files),
    "issues": ISSUES,
}
print(json.dumps(result, indent=2))
raise SystemExit(bool(ISSUES))
