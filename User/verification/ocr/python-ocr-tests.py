import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
ROOT=Path(os.environ.get('PGENRO_PROJECT_ROOT',HERE.parent.parent)).resolve()
sys.path.insert(0,str(ROOT))
from shared.ocr_fields import parse_header, parse_date, docx_text

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module

legacy=load('legacy_memo',ROOT/'Ocrr/memo.py')
incoming=load('incoming_ocr',ROOT/'User/OCR.py')
findings=[]

class OcrTests(unittest.TestCase):
    def test_header_cases(self):
        aliases={'docType':'documentType','sender':'sourceOffice','addressedTo':'recipient'}
        for case in json.loads((HERE/'header-cases.json').read_text()):
            with self.subTest(case=case['name']):
                result=parse_header(case['text'])
                for key,value in case['expected'].items():self.assertEqual(result[aliases.get(key,key)],value)
                findings.append({'scenario':case['name'],'result':'PASS'})

    def test_dates(self):
        for value in ['', '09/10/2026','2026-02-30','29 February 2027']:self.assertEqual(parse_date(value),'')
        self.assertEqual(parse_date('29 February 2028'),'2028-02-29')
        self.assertEqual(parse_date('Sept. 30, 2026'),'2026-09-30')

    def test_numeric_only_recovery_cannot_fill_document_fields(self):
        fields=incoming.extract_document_metadata('REQUEST LETTER\nSUBJECT: Assistance\n\nAn event takes place in October.',numeric_text='2025-02-01 007',numeric_tokens=['007'])
        self.assertEqual(fields['date'],'');self.assertEqual(fields['controlNo'],'')
        self.assertEqual(fields['detectedNumbers'],['007'])

    def test_incoming_text_endpoint(self):
        with incoming.app.test_client() as client:
            response=client.post('/ocr',data={'file':(io.BytesIO((HERE/'incoming.txt').read_bytes()),'incoming.txt')})
        self.assertEqual(response.status_code,200)
        fields=response.get_json()['metadata']
        self.assertEqual(fields['sourceOffice'],'OFFICE OF THE MUNICIPAL MAYOR')
        self.assertEqual(fields['recipient'],'PROVINCIAL ENRO')
        self.assertEqual(fields['date'],'2026-09-20');self.assertEqual(fields['receivedDate'],'2026-10-01')
        self.assertFalse(fields['isMemo'])

    def test_docx_endpoint_preserves_soft_breaks(self):
        self.assertIn('TO: PROVINCIAL ENRO\n',docx_text(HERE/'incoming.docx'))
        with incoming.app.test_client() as client:
            response=client.post('/ocr',data={'file':(io.BytesIO((HERE/'incoming.docx').read_bytes()),'incoming.docx')})
        self.assertEqual(response.status_code,200)
        fields=response.get_json()['metadata']
        self.assertEqual(fields['documentType'],'Request Letter')
        self.assertEqual(fields['subject'],'REQUEST FOR TECHNICAL ASSISTANCE FOR RIVER REHABILITATION')

    def test_legacy_native_memo_endpoint(self):
        with legacy.app.test_client() as client:
            response=client.post('/parse-memo-pdf',data={'pdf_file':(io.BytesIO((HERE/'memo.pdf').read_bytes()),'memo.pdf')})
        self.assertEqual(response.status_code,200)
        data=response.get_json()['data']
        self.assertEqual(data['memo_code'],'2026-077');self.assertEqual(data['target'],'ALL DIVISION HEADS')
        self.assertEqual(data['subject'],'SUBMISSION OF MONTHLY REPORTS')
        self.assertEqual(data['date'],'2026-10-01');self.assertEqual(data['authority'],'PROVINCIAL ENRO')
        self.assertTrue(data['isMemo'])

    def test_docx_table_and_page_breaks(self):
        fields=parse_header(docx_text(HERE/'memo-table.docx'))
        self.assertEqual(fields['controlNo'],'2026-041');self.assertEqual(fields['recipient'],'ALL PERSONNEL')
        self.assertEqual(fields['subject'],'WORK PLAN');self.assertEqual(fields['date'],'2026-10-01')
        text=docx_text(HERE/'memo-pages.docx');self.assertIn('\f',text)
        fields=parse_header(text)
        self.assertEqual(fields['controlNo'],'2026-042');self.assertEqual(fields['date'],'');self.assertEqual(fields['issuedBy'],'')

    def test_legacy_real_scanned_office_order(self):
        with legacy.app.test_client() as client:
            response=client.post('/parse-memo-pdf',data={'pdf_file':(io.BytesIO((ROOT/'User/uploads/tmp36gkc7tg.pdf').read_bytes()),'office-order.pdf')})
        self.assertEqual(response.status_code,200)
        data=response.get_json()['data']
        self.assertEqual(data['memo_code'],'25-002, s. 2025');self.assertEqual(data['date'],'2025-01-02')
        self.assertEqual(data['documentType'],'Office Order');self.assertFalse(data['isMemo'])
        self.assertEqual(data['authority'],'EnP JOHN FRANCIS L. LUZANO, MPA')
        self.assertIn('SCHEDULED LEAVE OF ABSENCE',data['subject'])

    def test_incoming_mixed_pdf_uses_scanned_header(self):
        with incoming.app.test_client() as client:
            response=client.post('/ocr',data={'file':(io.BytesIO((HERE/'mixed-incoming.pdf').read_bytes()),'mixed-incoming.pdf')})
        self.assertEqual(response.status_code,200)
        fields=response.get_json()['metadata']
        self.assertEqual(fields['controlNo'],'REF-2026-181')
        self.assertEqual(fields['documentType'],'Request Letter')
        self.assertIn('RIVER REHABILITATION',fields['subject'])

    def test_incoming_printed_scan_signature(self):
        with incoming.app.test_client() as client:
            response=client.post('/ocr',data={'file':(io.BytesIO((ROOT/'User/uploads/tmp36gkc7tg.pdf').read_bytes()),'office-order.pdf')})
        self.assertEqual(response.status_code,200)
        fields=response.get_json()['metadata']
        self.assertEqual(fields['sourceOffice'],'EnP JOHN FRANCIS L. LUZANO, MPA')
        self.assertEqual(fields['recipient'],'ALL PERSONNEL PG ENRO')
        self.assertEqual(fields['signatory'],'EnP JOHN FRANCIS L. LUZANO, MPA')
        self.assertEqual(fields['documentType'],'Office Order')

    def test_printed_images_and_embedded_word_scan(self):
        for filename in ['incoming-multipage.tiff','incoming.gif','incoming-scan.docx']:
            with self.subTest(filename=filename), incoming.app.test_client() as client:
                response=client.post('/ocr',data={'file':(io.BytesIO((HERE/filename).read_bytes()),filename)})
                self.assertEqual(response.status_code,200)
                fields=response.get_json()['metadata']
                self.assertEqual(fields['sourceOffice'],'OFFICE OF THE MUNICIPAL MAYOR')
                self.assertEqual(fields['recipient'],'PROVINCIAL ENRO')

    def test_mixed_pdf_image_only_name(self):
        for app,endpoint,key in [(incoming.app,'/ocr','file'),(legacy.app,'/parse-memo-pdf','pdf_file')]:
            with self.subTest(endpoint=endpoint), app.test_client() as client:
                response=client.post(endpoint,data={key:(io.BytesIO((HERE/'mixed-signatory.pdf').read_bytes()),'mixed-signatory.pdf')})
                self.assertEqual(response.status_code,200)
                fields=response.get_json()['metadata']
                self.assertEqual(fields['sourceOffice'],'MARIA L. SANTOS')
                self.assertEqual(fields['controlNo'],'SIGNED-2026-201')
                self.assertEqual(fields['subject'],'REQUEST FOR TECHNICAL ASSISTANCE')

    def test_digit_only_passes_are_not_run(self):
        with patch.object(incoming,'numeric_ocr_image',create=True,side_effect=AssertionError('numeric-only OCR should not run')), patch.object(incoming,'extract_pdf_numeric',create=True,side_effect=AssertionError('numeric-only PDF OCR should not run')):
            with incoming.app.test_client() as client:
                response=client.post('/ocr',data={'file':(io.BytesIO((HERE/'incoming.png').read_bytes()),'incoming.png')})
                self.assertEqual(response.status_code,200)
                self.assertEqual(client.get('/health').get_json()['focus'],'printed letters')
                self.assertFalse(client.get('/health').get_json()['numeric_ocr'])

    def test_missing_and_unsupported_uploads(self):
        with legacy.app.test_client() as client:
            self.assertEqual(client.post('/parse-memo-pdf').status_code,400)
            self.assertEqual(client.post('/parse-memo-pdf',data={'pdf_file':(io.BytesIO(b'text'),'file.txt')}).status_code,400)
        with incoming.app.test_client() as client:
            self.assertEqual(client.post('/ocr').status_code,400)
            self.assertEqual(client.post('/ocr',data={'file':(io.BytesIO(b'text'),'file.pptx')}).status_code,400)

if __name__=='__main__':
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(OcrTests)
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    (HERE/'python-ocr-results.json').write_text(json.dumps({'method':'Production Python parsers and both Flask test clients; real PDF/TXT/DOCX and system Tesseract','testsRun':result.testsRun,'headerScenarios':findings,'passed':result.wasSuccessful()},indent=2))
    sys.exit(0 if result.wasSuccessful() else 1)
