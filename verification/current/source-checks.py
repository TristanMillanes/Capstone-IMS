"""Syntax checks for production sources. Requires Node and tinycss2."""
import json
import subprocess
from pathlib import Path
import tinycss2

ROOT = Path(__file__).resolve().parents[2]
folders = ('admin', 'User', 'shared', 'SettingIMS', 'VisitorsLog', 'account')
javascript = sorted(p for folder in folders for p in (ROOT / folder).glob('*.js'))
stylesheets = sorted(p for folder in folders for p in (ROOT / folder).glob('*.css'))
python = [ROOT / name for name in ('User/OCR.py', 'shared/ocr_fields.py', 'ocr_server.py')]
errors = []
for file in javascript:
    result = subprocess.run(['node', '--check', str(file)], capture_output=True, text=True)
    if result.returncode:
        errors.append({'file': str(file.relative_to(ROOT)), 'error': result.stderr})
for file in stylesheets:
    items = tinycss2.parse_stylesheet(file.read_text(), skip_whitespace=True, skip_comments=True)
    for item in items:
        if item.type == 'error':
            errors.append({'file': str(file.relative_to(ROOT)), 'line': item.source_line, 'error': item.message})
        elif item.type == 'qualified-rule':
            for declaration in tinycss2.parse_declaration_list(item.content, skip_whitespace=True, skip_comments=True):
                if declaration.type == 'error':
                    errors.append({'file': str(file.relative_to(ROOT)), 'line': declaration.source_line, 'error': declaration.message})
for file in python:
    try:
        compile(file.read_bytes(), str(file), 'exec')
    except Exception as error:
        errors.append({'file': str(file.relative_to(ROOT)), 'error': str(error)})
report = {'passed': not errors, 'javascriptFiles': len(javascript), 'stylesheets': len(stylesheets), 'productionPythonFiles': len(python), 'errors': errors}
(Path(__file__).parent / 'source-results.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
if errors:
    raise SystemExit(1)
