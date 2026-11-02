"""Exercise the deployed Flask asset resolver without contacting Supabase."""
import importlib.util
import json
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location("pgenro_server_test", ROOT / "ocr_server.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)
client = server.app.test_client()


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and attrs.get("src"):
            self.refs.append(attrs["src"])
        if tag == "link" and "stylesheet" in attrs.get("rel", "").split():
            self.refs.append(attrs.get("href", ""))


errors, references, pages = [], 0, 0
for folder in ("admin", "User", "SettingIMS", "VisitorsLog"):
    for page in sorted((ROOT / folder).glob("*.html")):
        pages += 1
        parser = Assets()
        parser.feed(page.read_text(encoding="utf-8"))
        for ref in parser.refs:
            url = urlsplit(ref)
            if url.scheme or url.netloc or not url.path:
                continue
            target = (ROOT / unquote(url.path.lstrip("/"))) if url.path.startswith("/") else (page.parent / unquote(url.path))
            path = "/" + target.resolve().relative_to(ROOT).as_posix()
            response = client.get(path, follow_redirects=True)
            references += 1
            if response.status_code != 200:
                errors.append(f"{page.relative_to(ROOT)} -> {ref}: {response.status_code}")

binary_assets = {
    "/vendor/chart.umd.min.js": "javascript",
    "/vendor/pdfjs/pdf.min.mjs": "javascript",
    "/vendor/pdfjs/pdf.worker.min.mjs": "javascript",
    "/User/vendor/pdfjs/pdf.worker.min.mjs": "javascript",
    "/admin/assets/service-request/PGENRO_Service_Request_Template.pdf": "application/pdf",
    "/admin/assets/service-request/PGENRO_Service_Request_Template.docx": "wordprocessingml",
}
for path, mime in binary_assets.items():
    response = client.get(path)
    if response.status_code != 200 or mime not in response.content_type:
        errors.append(f"{path}: status={response.status_code}, MIME={response.content_type}")

aliases = {
    "/User/User/homepage.html": "/User/homepage.html",
    "/User/admin/Usermanagement.html": "/admin/Usermanagement.html",
    "/User/SettingIMS/Settings.html": "/SettingIMS/Settings.html",
    "/VisitorsLog/VisitorsLogin.html": "/VisitorsLog/visitorslog.html",
    "/admin/inventoryadmin.html": "/admin/invetoryadmin.html",
    "/user/homepage.html": "/User/homepage.html",
}
for source, destination in aliases.items():
    response = client.get(source)
    if response.status_code != 302 or response.headers.get("Location") != destination:
        errors.append(f"Alias {source}: {response.status_code} {response.headers.get('Location')}")
    if client.get(source, follow_redirects=True).status_code != 200:
        errors.append(f"Alias {source} does not reach an existing page")

blocked = ["/ocr_server.py", "/User/OCR.py", "/shared/ocr_fields.py", "/supabase/ADMIN_USER_ACCESS_PATCH.sql", "/.env", "/User/../ocr_server.py", "/verification/ui/mock-sdk.js"]
for path in blocked:
    if client.get(path).status_code != 404:
        errors.append(f"Non-public source was served: {path}")

result = {"passed": not errors, "htmlPages": pages, "localScriptAndStylesheetReferences": references,
          "binaryAndModuleAssets": len(binary_assets), "legacyRedirects": len(aliases),
          "blockedSourcePaths": len(blocked), "errors": errors}
(Path(__file__).parent / "server-assets-results.json").write_text(json.dumps(result, indent=2))
print(json.dumps(result, indent=2))
if errors:
    raise SystemExit(1)
