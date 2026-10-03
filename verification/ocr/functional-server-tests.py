"""Production OCR service checks; no database or external service is contacted."""
import io
import json
from pathlib import Path
import sys
import unittest
import pymupdf as fitz
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT))
from User import OCR as reader

findings = []

def upload(client, name, content=None, **kwargs):
    return client.post('/ocr', data={'file': (io.BytesIO(content if content is not None else (HERE / name).read_bytes()), name)}, **kwargs)

class FunctionalReaderTests(unittest.TestCase):
    def setUp(self):
        reader._cache.clear()

    def record(self, name, payload=None):
        findings.append({'scenario': name, 'result': 'PASS', **({k: payload[k] for k in ('processingMs', 'readingStats', 'cacheHit')} if payload else {})})

    def test_native_formats(self):
        with reader.app.test_client() as client:
            for name in ('incoming.csv', 'incoming-utf16.txt', 'incoming.xlsx', 'incoming.pptx', 'incoming.docx', 'incoming.pdf'):
                with self.subTest(name=name):
                    response = upload(client, name)
                    self.assertEqual(response.status_code, 200)
                    data = response.get_json()
                    self.assertEqual(data['metadata']['controlNo'], 'REF-2026-181')
                    self.assertEqual(data['metadata']['receivedFrom'], 'OFFICE OF THE MUNICIPAL MAYOR')
                    self.assertEqual(data['readingStats']['ocrPasses'], 0)
                    self.record('Native ' + name, data)

    def test_scan_rotation(self):
        with reader.app.test_client() as client:
            for angle in (90, 180, 270):
                buffer = io.BytesIO()
                with Image.open(HERE / 'incoming.png') as source:
                    source.rotate(angle, expand=True, fillcolor='white').save(buffer, 'PNG')
                data = upload(client, 'rotated.png', buffer.getvalue()).get_json()
                self.assertTrue(data['success'])
                self.assertEqual(data['metadata']['controlNo'], 'REF-2026-181')
                self.assertEqual(data['metadata']['recipient'], 'PROVINCIAL ENRO')
                self.record('Printed scan rotated ' + str(angle), data)

    def test_document_cache_uses_contents(self):
        with reader.app.test_client() as client:
            first = upload(client, 'incoming.png').get_json()
            second = upload(client, 'renamed.png', (HERE / 'incoming.png').read_bytes()).get_json()
            self.assertFalse(first['cacheHit'])
            self.assertTrue(second['cacheHit'])
            self.assertEqual(second['readingStats']['ocrPasses'], 0)
            self.assertEqual(second['metadata'], first['metadata'])
            self.assertEqual(second['filename'], 'renamed.png')
            self.record('Identical bytes reuse the read after renaming', second)

    def test_dates_and_memo_heading(self):
        text = 'REQUEST LETTER\nREF: TEST-901\nDATE: September 20, 2026\nDATE RECEIVED: October 1, 2026\nTO: PROVINCIAL ENRO\nSUBJECT: WORK\n\nPlease refer to memorandum 2026-099 dated October 3, 2026.\n\nRespectfully yours,\nMARIA L. SANTOS\nMunicipal Mayor'
        fields = reader.extract_document_metadata(text)
        self.assertEqual(fields['receivedFrom'], 'MARIA L. SANTOS')
        self.assertEqual(fields['date'], '2026-09-20')
        self.assertEqual(fields['receivedDate'], '2026-10-01')
        self.assertEqual(fields['releasedDate'], '')
        self.assertFalse(fields['isMemo'])
        self.record('Printed sender, issue/registry dates and body memo reference stay separate')

    def test_unheaded_letter_suggestions(self):
        text = 'September 20, 2026\nTO: PROVINCIAL ENRO\n\nDear Sir:\n\nI respectfully request technical assistance for river rehabilitation.\n\nRespectfully yours,\nMARIA L. SANTOS\nMunicipal Mayor'
        fields = reader.extract_document_metadata(text)
        self.assertEqual(fields['documentType'], 'Request Letter')
        self.assertEqual(fields['subject'], 'I respectfully request technical assistance for river rehabilitation.')
        self.assertEqual(fields['subjectSource'], 'body')
        self.assertEqual(fields['receivedFrom'], 'MARIA L. SANTOS')
        self.assertIn('subject', fields['needsReview'])
        self.assertIn('documentType', fields['needsReview'])
        self.assertFalse(fields['isMemo'])
        misread = reader.extract_document_metadata(text.replace('I respectfully request', '| respectfully request'))
        self.assertEqual(misread['documentType'], 'Request Letter')
        self.assertEqual(misread['subject'], fields['subject'])
        self.record('A letter without a heading suggests its purpose and marks inferred fields for review')

    def test_annex_and_ambiguous_names(self):
        text = 'REQUEST LETTER\nSUBJECT: WORK\n\nRespectfully yours,\nMARIA L. SANTOS\nDirector\n\f\nANNEX A\nSincerely,\nPEDRO R. REYES\nManager'
        self.assertEqual(reader.extract_document_metadata(text)['receivedFrom'], 'MARIA L. SANTOS')
        fields = reader.extract_document_metadata(text.split('\f')[0] + '\nPEDRO R. REYES\nManager')
        self.assertEqual(fields['receivedFrom'], '')
        self.assertIn('receivedFrom', fields['needsReview'])
        self.assertEqual(len(fields['signatoryCandidates']), 2)
        self.record('Annex names are excluded and equal signatories require a choice')

    def test_invalid_documents(self):
        blank = io.BytesIO()
        Image.new('RGB', (800, 1000), 'white').save(blank, 'PNG')
        with reader.app.test_client() as client:
            self.assertEqual(upload(client, 'empty.pdf', b'').status_code, 422)
            self.assertEqual(upload(client, 'broken.pdf', b'not a PDF').status_code, 400)
            self.assertEqual(upload(client, 'broken.png', b'not an image').status_code, 400)
            self.assertEqual(upload(client, 'old.doc', b'not an Office archive').status_code, 415)
            response = upload(client, 'blank.png', blank.getvalue())
            self.assertEqual(response.status_code, 422)
            self.assertFalse(response.get_json()['success'])
        self.record('Empty, corrupt, unsupported and blank files return clear errors')

    def test_locked_pdf(self):
        document = fitz.open()
        document.new_page().insert_text((72, 72), 'PRIVATE LETTER')
        content = document.tobytes(encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw='owner', user_pw='reader')
        document.close()
        with reader.app.test_client() as client:
            response = upload(client, 'locked.pdf', content)
        self.assertEqual(response.status_code, 400)
        self.assertIn('password protected', response.get_json()['error'])
        self.record('Password-protected PDF asks for an unlocked copy')

    def test_cancel_race_and_recovery(self):
        with reader.app.test_client() as client:
            self.assertEqual(client.post('/cancel', json={'requestId': 'cancel-before-upload'}).status_code, 200)
            stopped = upload(client, 'incoming.png', headers={'X-OCR-Request-ID': 'cancel-before-upload'})
            self.assertEqual(stopped.status_code, 409)
            self.assertEqual(client.get('/health').get_json()['activeReads'], 0)
            self.assertEqual(upload(client, 'incoming.png').status_code, 200)
            self.assertEqual(client.post('/cancel', json={'requestId': '../invalid'}).status_code, 400)
        self.record('Stop racing with upload releases the reader and allows another read')

if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(FunctionalReaderTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    (HERE / 'functional-server-results.json').write_text(json.dumps({'method': 'Production Flask app and real local Tesseract; no external database', 'passed': result.wasSuccessful(), 'testMethods': result.testsRun, 'scenarios': findings}, indent=2))
    sys.exit(not result.wasSuccessful())
