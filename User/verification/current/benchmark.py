"""Run once per implementation in a fresh process for a fair cold-read comparison."""
import io
import json
import os
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import pymupdf as fitz
from werkzeug.datastructures import FileStorage

PROJECT = Path(__file__).resolve().parents[2]
SOURCE = Path(os.environ.get('PGENRO_BENCH_ROOT', PROJECT))
sys.path.insert(0, str(SOURCE))
from User import OCR

HERE = Path(__file__).resolve().parent
font_path = Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
if not font_path.is_file():
    font_path = next(Path('/usr/share/fonts').rglob('*.ttf'))
font = ImageFont.truetype(str(font_path), 42)
image = Image.new('RGB', (3200, 4200), 'white')
draw = ImageDraw.Draw(image)
lines = ['REQUEST LETTER', 'CONTROL NO: REF-2026-221', 'DATE: October 1, 2026', 'TO: PROVINCIAL ENRO', 'FROM: OFFICE OF THE MUNICIPAL MAYOR', '', 'SUBJECT: REQUEST FOR TECHNICAL ASSISTANCE', '', 'Dear Sir:', '', 'We respectfully request technical assistance for river rehabilitation.', 'Please coordinate the schedule of the site inspection with our office.', '', 'Respectfully yours,', 'MARIA L. SANTOS', 'Municipal Mayor']
for number, line in enumerate(lines):
    draw.text((320, 380 + number * 78), line, font=font, fill='black')
buffer = io.BytesIO(); image.save(buffer, 'PNG')
wide_scan = buffer.getvalue()
with fitz.open() as document:
    for i in range(6):
        page = document.new_page(width=612, height=792)
        page.insert_image(page.rect, stream=wide_scan)
    repeated_pdf = document.tobytes()

cases = [('native-letter.pdf', (PROJECT / 'verification/ocr/incoming.pdf').read_bytes()), ('wide-margins.png', wide_scan), ('six-page-scan.pdf', repeated_pdf)]
measurements = []
for name, content in cases:
    OCR._cache.clear()
    if hasattr(OCR, '_page_cache'):
        OCR._page_cache.clear()
    payload, status = OCR.process_uploaded_file(FileStorage(stream=io.BytesIO(content), filename=name))
    if status != 200:
        raise RuntimeError(payload)
    fields = payload['metadata']
    expected_fields = name == 'native-letter.pdf' or (fields['receivedFrom'] == 'MARIA L. SANTOS' and fields['controlNo'] == 'REF-2026-221' and 'TECHNICAL ASSISTANCE' in fields['subject'])
    measurements.append({'file': name, 'status': status, 'durationMs': payload['durationMs'], 'pages': payload['pages'], 'ocrPasses': payload['readingStats']['ocrPasses'], 'cachedPages': payload['readingStats'].get('cachedPages', 0), 'expectedFieldsMatch': expected_fields, 'fields': {key: fields.get(key) for key in ['controlNo', 'subject', 'receivedFrom', 'documentType']}})
    print(name, payload['durationMs'], 'ms', payload['readingStats'], flush=True)
    if name == 'six-page-scan.pdf':
        cached, status = OCR.process_uploaded_file(FileStorage(stream=io.BytesIO(content), filename='renamed-scan.pdf'))
        assert status == 200 and cached['cacheHit']
        measurements.append({'file': 'same-file-retry.pdf', 'durationMs': cached['durationMs'], 'pages': cached['pages'], 'ocrPasses': cached['readingStats']['ocrPasses']})

label = os.environ.get('PGENRO_BENCH_LABEL', 'updated')
(HERE / ('benchmark-' + label + '.json')).write_text(json.dumps({'profile': {'workers': OCR.OCR_WORKERS, 'dpi': OCR.OCR_DPI, 'maxSide': OCR.OCR_MAX_SIDE}, 'measurements': measurements}, indent=2))
if label == 'updated':
    assert all(case.get('expectedFieldsMatch', True) for case in measurements), measurements
