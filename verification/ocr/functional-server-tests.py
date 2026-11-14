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

    def test_optional_registry_fields_flow_to_frontend_form(self):
        text = (
            'REQUEST LETTER\n'
            'CONTROL NO: REF-2026-181\n'
            'DATE: September 20, 2026\n'
            'TO: PROVINCIAL ENRO\n'
            'SUBJECT: REQUEST FOR TECHNICAL ASSISTANCE\n'
            'STATUS: Forwarded\n'
            'ACTION TAKEN: Forwarded to Planning Division\n'
            'REMARKS: Original received and logged.\n'
            '\nDear Sir:\nPlease provide technical assistance.\n'
            'Respectfully yours,\nMARIA L. SANTOS\nMunicipal Mayor'
        )
        metadata = reader.extract_document_metadata(text)
        self.assertEqual(metadata['status'], 'Forwarded')
        self.assertEqual(metadata['actionTaken'], 'Forwarded to Planning Division')
        self.assertEqual(metadata['remarks'], 'Original received and logged.')
        payload = reader.communication_form_payload(metadata, text, 'Incoming')
        values = payload['formValues']
        self.assertEqual(values['statusSelect'], 'Forwarded')
        self.assertEqual(values['actionTakenInput'], 'Forwarded to Planning Division')
        self.assertEqual(values['remarksInput'], 'Original received and logged.')
        self.record('Explicit status, action and remarks populate the frontend form contract')

    def test_dates_and_memo_heading(self):
        text = 'REQUEST LETTER\nREF: TEST-901\nDATE: September 20, 2026\nDATE RECEIVED: October 1, 2026\nTO: PROVINCIAL ENRO\nSUBJECT: WORK\n\nPlease refer to memorandum 2026-099 dated October 3, 2026.\n\nRespectfully yours,\nMARIA L. SANTOS\nMunicipal Mayor'
        fields = reader.extract_document_metadata(text)
        self.assertEqual(fields['receivedFrom'], 'MARIA L. SANTOS')
        self.assertEqual(fields['date'], '2026-09-20')
        self.assertEqual(fields['receivedDate'], '2026-10-01')
        self.assertEqual(fields['releasedDate'], '')
        self.assertFalse(fields['isMemo'])
        self.record('Printed sender, issue/registry dates and body memo reference stay separate')

    def test_field_mapping_keeps_registry_dates_and_adjacent_labels_separate(self):
        text = (
            'REPUBLIC OF THE PHILIPPINES\nREQUEST LETTER\n'
            'COMMUNICATION TYPE: Outgoing\n'
            'CONTROL NO.: COMM-2026-17  |  DOCUMENT TYPE: Request Letter\n'
            'RECEIVED FROM: Receiving Office\n'
            'SENT TO: Municipal Environment Office\n'
            'DATE ISSUED: November 7, 2026\nDATE RECEIVED:\nNovember 8, 2026\n'
            'RELEASED DATE: November 9, 2026\n'
            'SUBJECT / PARTICULARS: Seedling request\nFOR RIVER REHABILITATION\n'
            'ACTION TAKEN: Forwarded to Planning Division\nDATE FORWARDED: November 10, 2026\n'
            'REMARKS:\nSTATUS: Forwarded\n\n'
            'Dear Sir:\nThe activity will take place on November 11, 2026.\n'
            'REMARKS: This line is part of the letter body.'
        )
        with reader.app.test_client() as client:
            for direction, date, office in (
                ('Incoming', '2026-11-08', 'Receiving Office'),
                ('Outgoing', '2026-11-09', 'Municipal Environment Office'),
            ):
                response = client.post('/ocr', data={
                    'file': (io.BytesIO(text.encode()), 'registry.txt'), 'communicationType': direction,
                })
                self.assertEqual(response.status_code, 200)
                result = response.get_json()
                values = result['formValues']
                self.assertEqual(result['metadata']['direction'], 'Outgoing')
                self.assertEqual(values['dateInput'], date)
                self.assertEqual(values['officeInput'], office)
                self.assertEqual(values['controlNoInput'], 'COMM-2026-17')
                self.assertEqual(values['subjectInput'], 'Seedling request FOR RIVER REHABILITATION')
                self.assertEqual(values['actionTakenInput'], 'Forwarded to Planning Division\nDate forwarded: November 10, 2026')
                self.assertEqual(values['statusSelect'], 'Forwarded')
                self.assertEqual(values['remarksInput'], '')
        fields = reader.extract_document_metadata('REQUEST LETTER\nDATE ISSUED: November 7, 2026\nSUBJECT: Work')
        self.assertEqual(reader.communication_form_payload(fields, '', 'Incoming')['formValues']['dateInput'], '')
        self.assertEqual(reader.communication_form_payload(fields, '', 'Outgoing')['formValues']['dateInput'], '')
        self.assertEqual(reader.parse_date('11/09/2026'), '')
        self.record('Direction, date, sender/recipient and workflow values map to their own fields')

    def test_memo_uses_the_printed_issuer_and_leaves_missing_fields_empty(self):
        text = (
            'MEMORANDUM NO. 12, s. 2026\nCONTROL NO: COMM-99\n'
            'TO  ALL SECTION CHIEFS\nISSUED BY  PGENRO ADMIN DIVISION\n'
            'DATE ISSUED:\n14 Nobyembre 2026\nSUBJECT: Work plans\n'
            'REMARKS:\n\nKeep the original with the official records.\n\n'
            'The annual work plans are due on November 30, 2026.\n'
            'Signed by: ANA R. REYES\nDirector'
        )
        fields = reader.extract_document_metadata(text)
        self.assertEqual(fields['issuedBy'], 'PGENRO ADMIN DIVISION')
        self.assertEqual(fields['signatory'], 'ANA R. REYES')
        self.assertEqual(fields['remarks'], 'Keep the original with the official records.')
        values = reader.communication_form_payload(fields, text)['formValues']
        self.assertEqual(values['controlNoInput'], '12, s. 2026')
        self.assertEqual(values['memoRecipientInput'], 'ALL SECTION CHIEFS')
        self.assertEqual(values['memoIssuerInput'], 'PGENRO ADMIN DIVISION')
        self.assertEqual(values['dateInput'], '2026-11-14')
        incomplete = reader.extract_document_metadata(
            'MEMORANDUM\nTO: N/A\nISSUED BY: ---\nSUBJECT: Update\n\n'
            'Please submit the reports on November 30, 2026.\nSigned by: ANA R. REYES\nDirector'
        )
        self.assertEqual((incomplete['date'], incomplete['issuedBy'], incomplete['recipient']), ('', '', ''))
        self.record('Memo number, issue date, issuer and signatory are read separately')

    def test_mixed_pdf_recovers_the_scanned_header(self):
        with reader.app.test_client() as client:
            result = upload(client, 'mixed-incoming.pdf').get_json()
        self.assertTrue(result['success'])
        self.assertEqual(result['formValues']['controlNoInput'], 'REF-2026-181')
        self.assertEqual(result['formValues']['officeInput'], 'OFFICE OF THE MUNICIPAL MAYOR')
        self.assertEqual(result['formValues']['dateInput'], '2026-10-01')
        self.record('A scanned PDF header supplies the fields when selectable text only contains an archive notice')

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
        fields = reader.extract_document_metadata(text.split('\f')[0] + '\n\nRespectfully yours,\nPEDRO R. REYES\nManager')
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
