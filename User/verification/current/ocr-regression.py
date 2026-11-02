"""Current production OCR regression checks. Uses Tesseract; no hosted database."""
import io
import json
import os
import sys
import threading
import time
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

os.environ['OCR_WORKERS'] = '1'
os.environ['OCR_DOCUMENT_WORKERS'] = '1'
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from User import OCR
import ocr_server
import pymupdf as fitz
from PIL import Image

FIXTURES = ROOT / 'verification/ocr'
REPORT = []


def pdf_scan(pages=3, title='first'):
    with fitz.open() as doc:
        for i in range(pages):
            page = doc.new_page(width=612, height=792)
            page.insert_image(page.rect, stream=(FIXTURES / 'incoming.png').read_bytes())
        doc.set_metadata({'title': title})
        return doc.tobytes()


def upload(name, content, request_id=''):
    with OCR.app.test_client() as client:
        return client.post('/ocr', data={'file': (io.BytesIO(content), name)}, headers={'X-OCR-Request-ID': request_id} if request_id else {})


class RegressionTests(unittest.TestCase):
    def setUp(self):
        OCR._cache.clear()
        OCR._page_cache.clear()

    def tearDown(self):
        REPORT.append({'test': self.id().split('.')[-1], 'completed': True})

    def test_inline_and_continued_signatures(self):
        for suffix in [
            'Respectfully yours, MARIA L. SANTOS\nMunicipal Mayor',
            'Respectfully yours,\nMARIA L. SANTOS, Municipal Mayor',
            'Respectfully yours,\fMARIA L. SANTOS',
            'Signed by: Atty.MARIA L. SANTOS, Municipal Mayor',
        ]:
            expected = 'Atty. MARIA L. SANTOS' if suffix.startswith('Signed') else 'MARIA L. SANTOS'
            text = 'REQUEST LETTER\nTO: PROVINCIAL ENRO\nFROM: MUNICIPAL OFFICE\nSUBJECT: Assistance\n\nPlease assist.\n\n' + suffix
            result = OCR.extract_document_metadata(text)
            self.assertEqual(result['receivedFrom'], expected)
            self.assertEqual(result['recipient'], 'PROVINCIAL ENRO')

    def test_business_address_and_inferred_purpose(self):
        text = 'September 20, 2026\n\nHON. JUAN DELA CRUZ\nMunicipal Mayor\nOffice of the Municipal Mayor\n\nDear Mayor:\n\nI respectfully request technical assistance for river rehabilitation.\n\nSincerely yours,\nMARIA L. SANTOS\nDepartment Head'
        result = OCR.extract_document_metadata(text)
        self.assertIn('HON. JUAN DELA CRUZ', result['recipient'])
        self.assertEqual(result['receivedFrom'], 'MARIA L. SANTOS')
        self.assertEqual(result['documentType'], 'Request Letter')
        self.assertIn('subject', result['needsReview'])
        self.assertIn('documentType', result['needsReview'])

    def test_all_pages_and_cross_document_page_reuse(self):
        response = upload('scan.pdf', pdf_scan(3), 'qa-reuse-one')
        self.assertEqual(response.status_code, 200, response.get_json())
        first = response.get_json()
        self.assertEqual(first['pages'], 3)
        self.assertEqual(first['readingStats']['ocrPasses'], 1)
        self.assertEqual(first['readingStats']['cachedPages'], 2)
        self.assertEqual(first['metadata']['controlNo'], 'REF-2026-181')
        second = upload('repackaged.pdf', pdf_scan(3, 'different bytes')).get_json()
        self.assertFalse(second['cacheHit'])
        self.assertEqual(second['readingStats']['ocrPasses'], 0)
        self.assertEqual(second['readingStats']['cachedPages'], 3)
        self.assertEqual(second['text'], first['text'])
        with OCR.app.test_client() as client:
            status = client.get('/ocr/status/qa-reuse-one').get_json()
            self.assertFalse(status['active'])
            self.assertEqual(status['completedPages'], 3)
            self.assertEqual(status['stage'], 'Complete')

    def test_header_images_in_word_documents(self):
        stream = io.BytesIO()
        ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
        with zipfile.ZipFile(stream, 'w') as archive:
            archive.writestr('word/document.xml', f'<w:document xmlns:w="{ns}"><w:body><w:p><w:r><w:t>Document body continues here.</w:t></w:r></w:p></w:body></w:document>')
            archive.writestr('word/header1.xml', f'<w:hdr xmlns:w="{ns}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:p><w:r><w:drawing><a:blip r:embed="image1"/></w:drawing></w:r></w:p></w:hdr>')
            archive.writestr('word/_rels/header1.xml.rels', '<Relationships><Relationship Id="image1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/scan.png"/></Relationships>')
            archive.writestr('word/media/scan.png', (FIXTURES / 'incoming.png').read_bytes())
        response = upload('scanned-header.docx', stream.getvalue())
        self.assertEqual(response.status_code, 200, response.get_json())
        result = response.get_json()
        self.assertEqual(result['metadata']['controlNo'], 'REF-2026-181')
        self.assertIn('Document body continues here.', result['text'])

    def test_date_semantics_and_memo_number(self):
        result = OCR.extract_document_metadata('MEMORANDUM NO. 17, s. 2026\nCONTROL NO: REG-2026-101\nDATE ISSUED: September 20, 2026\nDATE RECEIVED: October 1, 2026\nDATE RELEASED: October 2, 2026\nTO: ALL PERSONNEL\nSUBJECT: Monthly reports\n\nFor your compliance.\nMARIA L. SANTOS\nDepartment Head')
        self.assertEqual(result['memoNo'], '17, s. 2026')
        self.assertEqual(result['controlNo'], 'REG-2026-101')
        self.assertEqual((result['date'], result['receivedDate'], result['releasedDate']), ('2026-09-20', '2026-10-01', '2026-10-02'))

    def test_cancel_queued_request_and_retry(self):
        entered, release = threading.Event(), threading.Event()
        results = {}
        text = 'REQUEST LETTER\nTO: ENRO\nSUBJECT: Assistance\n\nPlease assist.'
        def slow_read(path, extension):
            entered.set()
            release.wait(4)
            return {'text': text, 'metadata': OCR.extract_document_metadata(text), 'warnings': [], 'pages': 1}
        def work(label):
            results[label] = upload(label + '.txt', (text + label).encode(), label).status_code
        with patch.object(OCR, 'read_document', slow_read):
            first = threading.Thread(target=work, args=('qa-busy',))
            queued = threading.Thread(target=work, args=('qa-queued',))
            first.start()
            self.assertTrue(entered.wait(2))
            queued.start()
            end = time.monotonic() + 2
            with OCR.app.test_client() as client:
                while time.monotonic() < end:
                    status = client.get('/ocr/status/qa-queued')
                    if status.status_code == 200:
                        break
                    time.sleep(.01)
                self.assertEqual(status.status_code, 200)
                self.assertEqual(status.get_json()['stage'], 'Waiting for the document reader')
                self.assertEqual(client.post('/cancel', json={'requestId': 'qa-queued'}).status_code, 200)
            queued.join(2)
            release.set()
            first.join(3)
        self.assertEqual(results['qa-queued'], 409)
        self.assertEqual(results['qa-busy'], 200)
        self.assertEqual(upload('retry.txt', text.encode(), 'qa-retry').status_code, 200)

    def test_deployment_pages_assets_and_access_boundary(self):
        from html.parser import HTMLParser
        class Assets(HTMLParser):
            paths = []
            def handle_starttag(self, tag, attrs):
                data = dict(attrs)
                if tag in ('script', 'link', 'img'):
                    value = data.get('src') or data.get('href') or ''
                    if value and not value.startswith(('http:', 'https:', 'data:', '#')):
                        self.paths.append(value.split('?')[0])
        with OCR.app.test_client() as client:
            for folder in ['admin', 'User', 'SettingIMS', 'VisitorsLog']:
                for path in (ROOT / folder).glob('*.html'):
                    response = client.get('/' + path.relative_to(ROOT).as_posix())
                    self.assertEqual(response.status_code, 200, path.name)
                    parser = Assets(); parser.paths = []; parser.feed(path.read_text())
                    for asset in parser.paths:
                        local = (path.parent / asset).resolve()
                        self.assertTrue(local.is_relative_to(ROOT), asset)
                        response = client.get('/' + local.relative_to(ROOT).as_posix())
                        self.assertEqual(response.status_code, 200, str(local))
            for forbidden in ['/Dockerfile', '/User/OCR.py', '/shared/ocr_fields.py', '/supabase/schema.sql', '/.env', '/admin/../User/OCR.py']:
                self.assertEqual(client.get(forbidden).status_code, 404)
            for alias in ['/admin', '/Admin/Admin.html', '/user/homepage.html', '/admin/inventory']:
                self.assertEqual(client.get(alias, follow_redirects=True).status_code, 200)
            self.assertIn('no-store', client.get('/admin/admin.html').headers['Cache-Control'])


if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(RegressionTests))
    (ROOT / 'verification/current/ocr-regression-results.json').write_text(json.dumps({'passed': result.wasSuccessful(), 'testsRun': result.testsRun, 'method': 'Production Flask app, real Tesseract, local fixtures; no hosted database', 'results': REPORT, 'failures': [str(test) + ': ' + message for test, message in result.failures + result.errors]}, indent=2))
    sys.exit(not result.wasSuccessful())
