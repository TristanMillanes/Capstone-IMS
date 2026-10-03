"""PGENRO full-document OCR service. Run: python OCR.py
Reads every page; receivedFrom is the printed signatory, then explicit sender.
Tesseract is invoked locally. Documents are never sent to another OCR service.
"""
from __future__ import annotations
import csv
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import statistics
import sys
import unicodedata
import zipfile
import time
import hashlib
import copy
import threading
import contextvars
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET
# Import the existing project header reader even when this file is launched from User/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from shared.ocr_fields import parse_header, docx_text
if __name__ == '__main__':
    print('[STARTUP] Loading the complete PGENRO OCR server...', flush=True)
    print('[PYTHON]', sys.executable, flush=True)
    print('[SCRIPT]', Path(__file__).resolve(), flush=True)
try:
    import pymupdf as fitz
    from PIL import Image, ImageEnhance, ImageOps, ImageSequence, ImageChops, ImageStat, UnidentifiedImageError
except ImportError:
    if __name__ == '__main__':
        print('[STARTUP ERROR] OCR packages could not be imported. Run START_OCR.bat in this folder.', file=sys.stderr, flush=True)
    raise
MAX_BYTES = 50 * 1024 * 1024
ALLOWED_EXTENSIONS = {'pdf', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff', 'docx', 'txt', 'csv', 'xlsx', 'pptx'}
OCR_LANG = os.getenv('OCR_LANG', 'eng')
OCR_TIMEOUT = max(5, int(os.getenv('OCR_TIMEOUT', '40')))
OCR_DOCUMENT_TIMEOUT = max(OCR_TIMEOUT, int(os.getenv('OCR_DOCUMENT_TIMEOUT', '120')))
OCR_WORKERS = max(1, min(4, int(os.getenv('OCR_WORKERS', str(min(2, os.cpu_count() or 1))))))
OCR_DPI = max(150, min(400, int(os.getenv('OCR_DPI', '240'))))
OCR_MAX_SIDE = max(1600, min(5000, int(os.getenv('OCR_MAX_SIDE', '3000'))))
OCR_MIN_CONFIDENCE = float(os.getenv('OCR_MIN_CONFIDENCE', '65'))
OCR_NUMERIC_ENABLED = os.getenv('OCR_NUMERIC_PASS', '0').lower() not in ('0', 'false', 'off')
OCR_CACHE_SIZE = max(0, int(os.getenv('OCR_CACHE_SIZE', '20')))
OCR_CACHE_TTL = max(0, int(os.getenv('OCR_CACHE_TTL', '600')))
_pool = ThreadPoolExecutor(max_workers=OCR_WORKERS, thread_name_prefix='pgenro-ocr')
_ocr_slots = threading.BoundedSemaphore(OCR_WORKERS)
_state = contextvars.ContextVar('ocr_state', default=None)
_cache = OrderedDict()
_cache_lock = threading.Lock()
_cache_bytes = 0
_CACHE_MAX_BYTES = 8 * 1024 * 1024
_active_reads = {}
_cancelled_reads = OrderedDict()
_reads_lock = threading.Lock()

class ReadCancelled(RuntimeError):
    pass

class DocumentTimeout(RuntimeError):
    pass

class ReadState:
    def __init__(self):
        self.started = time.monotonic()
        self.deadline = self.started + OCR_DOCUMENT_TIMEOUT
        self.passes = 0
        self.confidences = []
        self.warnings = []
        self.lock = threading.Lock()
        self.cancelled = threading.Event()

    def remaining(self):
        if self.cancelled.is_set():
            raise ReadCancelled('The document read was stopped.')
        value = self.deadline - time.monotonic()
        if value <= 0:
            raise DocumentTimeout('The document reached the OCR time limit. Split it into smaller files or increase OCR_DOCUMENT_TIMEOUT.')
        return value

def check_budget():
    current = _state.get()
    return current.remaining() if current else OCR_DOCUMENT_TIMEOUT

def warn(message):
    current = _state.get()
    if current:
        with current.lock:
            if message not in current.warnings:
                current.warnings.append(message)

def cached_result(key):
    with _cache_lock:
        entry = _cache.get(key)
        if entry and time.monotonic() - entry[0] <= OCR_CACHE_TTL:
            _cache.move_to_end(key)
            return copy.deepcopy(entry[1])
    return None

def cache_result(key, result):
    global _cache_bytes
    if not OCR_CACHE_SIZE or not OCR_CACHE_TTL:
        return
    size = len(json.dumps(result, ensure_ascii=False).encode('utf-8'))
    if size > _CACHE_MAX_BYTES:
        return
    with _cache_lock:
        old = _cache.pop(key, None)
        if old:
            _cache_bytes -= old[2]
        _cache[key] = (time.monotonic(), copy.deepcopy(result), size)
        _cache_bytes += size
        while len(_cache) > OCR_CACHE_SIZE or _cache_bytes > _CACHE_MAX_BYTES:
            _, removed = _cache.popitem(last=False)
            _cache_bytes -= removed[2]
TESSERACT_CMD = os.getenv('TESSERACT_CMD') or shutil.which('tesseract')
if not TESSERACT_CMD:
    for root in (r'C:\Program Files', r'C:\Program Files (x86)', 'C:'):
        candidate = Path(root) / 'Tesseract-OCR' / 'tesseract.exe'
        if candidate.is_file():
            TESSERACT_CMD = str(candidate)
            break
TESSERACT_CMD = TESSERACT_CMD or 'tesseract'
CLOSING = re.compile(r'^(?:(?:very\s+)?(?:yours\s+)?(?:sincerely|respectfully|faithfully|truly)(?:\s+(?:yours|submitted))?|yours\s+(?:truly|faithfully|sincerely|respectfully)|best\s+regards|kind\s+regards|regards|cordially|lubos\s+na\s+gumagalang|sumasainyo|for\s+your\s+(?:compliance|information\s+and\s+compliance|guidance\s+and\s+compliance))\s*[,.:!]?$', re.I)
ROLE = re.compile(r'\b(?:PGDH|PGENRO|ENRO|officer|director|chief|mayor|governor|administrator|supervisor|manager|secretary|head|president|chairperson|chairman|coordinator|principal|teacher|engineer|treasurer|representative|proprietor|owner|student|applicant|dean|professor|specialist|staff|assistant|councilor|punong\s+barangay)\b', re.I)
SIGN_LABEL = re.compile(r'^(?:signed(?:\s+by)?|signatory|submitted\s+by|prepared\s+by|approved\s+by|noted\s+by|certified\s+by|recommending\s+approval|respectfully\s+submitted\s+by|name\s+of\s+(?:sender|signatory))\s*[:：-]?\s*(.*)$', re.I)
FIELD_LABEL = re.compile(r'^(?:SUBJECT(?:\s+MATTER)?|SUBJEC[TIL1]|SUBJ|RE|DATE(?:\s+(?:ISSUED|RECEIVED|RELEASED))?|DATED|TO|T0|FOR|FROM|SENDER|THROUGH|THRU|CC|ATTACHMENTS?|ENCLOSURES?|REF(?:ERENCE)?|CONTROL(?:\s+(?:NO\.?|NUMBER))?|ISSUED\s+BY|SIGNATORY|REMARKS)\s*[:：;\-]', re.I)
BODY = re.compile(r'^(?:DEAR|GREETINGS|SIR|MADAM|MA\x27AM|TO\s+WHOM|PLEASE|KINDLY|THIS\s+(?:IS|HAS|WILL|REFERS)|WE\s+(?:ARE|WILL|WOULD|REQUEST)|I\s+(?:AM|WOULD)|YOU\s+ARE|THE\s+UNDERSIGNED|IN\s+(?:LIGHT\s+OF|CONNECTION\s+WITH)|PURSUANT\s+TO|FOR\s+YOUR\s+(?:INFORMATION|COMPLIANCE)|SINCERELY|RESPECTFULLY)\b', re.I)
def tidy(value):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFC', str(value or ''))).strip()
def clean_text(text):
    text = str(text or '').replace('\r\n', '\n').replace('\r', '\n').replace('\u00a0', ' ')
    # Keep table-cell gaps: the header parser uses them to recover bare labels.
    return '\n\f\n'.join('\n'.join(re.sub(r'[ \t]{2,}', '  ', line).strip() for line in page.split('\n')).strip() for page in text.split('\f')).strip(' \t\r\n')
def name_value(value):
    value = re.sub(r'^(?:\(\s*sgd\.?\s*\)|sgd\.?|/s/|by\s*:)\s*', '', tidy(value), flags=re.I).strip('|:_- ')
    value = re.split(r'\s+[—–]\s+', value)[0]
    if not 4 <= len(value) <= 100 or re.search(r'[\d@:/;!?()]', value):
        return ''
    if re.search(r'\b(?:republic|province|government|office|department|division|subject|memorandum|dear|thank|please|request|hereby|attached|enclosed|address|telephone|email|received|copy|cc|page|for|to|from)\b', value, re.I):
        return ''
    base = re.sub(r'^(?:(?:Mr|Mrs|Ms|Miss|Dr|Dra|Atty|Engr|EnP|Hon|Prof|Rev|Fr|Bro|Sis)\.?\s+)+', '', value, flags=re.I)
    base = re.sub(r',?\s+(?:Ph\.?D\.?|M\.?D\.?|MBA|CPA|RN|LPT|CESO(?:\s+[IVX]+)?|EnP)(?:[,\s].*)?$', '', base, flags=re.I)
    # Use whitespace tokens so compound and accented surnames remain intact.
    words = base.replace(',', ' ').split()
    if not 2 <= len(words) <= 8 or ROLE.search(base):
        return ''
    particles = {'de', 'del', 'dela', 'la', 'las', 'los', 'da', 'dos', 'di', 'du', 'van', 'von', 'bin', 'al', 'y', 'jr.', 'jr', 'sr.', 'sr', 'ii', 'iii', 'iv'}
    if any(not (word.lower() in particles or word[0].isupper()) for word in words):
        return ''
    if sum(len(''.join(c for c in word if c.isalpha())) > 1 for word in words) < 2:
        return ''
    if any(not all(c.isalpha() or c in ".'’-" for c in word) for word in words):
        return ''
    value = re.sub(r'\.{2,}', '.', value)
    return re.sub(r'(?<=\s)([A-Z])(?=\s)', r'\1.', value)
def parse_correspondence(text, signature_region=False):
    entries = []
    for page_number, page in enumerate(str(text or '').replace('\r', '').split('\f'), 1):
        top = [tidy(line) for line in page.split('\n') if tidy(line)][:8]
        if page_number > 1 and any(re.match(r'^(?:ANNEX|APPENDIX|ATTACHMENT|ENCLOSURE)\b|^(?:(?:PG\s*ENRO|PGENRO)\s+)?(?:OFFICE\s+)?(?:MEMORANDUM|MEMO|REQUEST LETTER|OFFICE ORDER)\b', line, re.I) for line in top):
            break
        excluded = False
        for line_number, line in enumerate(page.split('\n'), 1):
            if re.match(r'^\s*(?:CC\s*:|COPY\s+(?:TO|FURNISHED)|ANNEX\b|APPENDIX\b|ATTACHMENTS?\s*:|ENCLOSURES?\s*:)', line, re.I):
                excluded = True
            if tidy(line):
                entries.append({'text': tidy(line), 'page': page_number, 'line': line_number, 'excluded': excluded})
    candidates = []
    for i, entry in enumerate(entries):
        if entry['excluded']:
            continue
        match = SIGN_LABEL.match(entry['text'])
        name = name_value(match.group(1) if match and match.group(1) else entry['text'])
        if not name:
            continue
        before = [e for e in entries[max(0, i - 6):i] if e['page'] == entry['page']]
        marker = next((e for e in reversed(before) if SIGN_LABEL.match(e['text'])), None)
        near_closing = any(CLOSING.match(e['text']) for e in before)
        following = entries[i + 1]['text'] if i + 1 < len(entries) and entries[i + 1]['page'] == entry['page'] else ''
        has_role = bool(ROLE.search(following)) and not re.match(r'^dear\b', following, re.I)
        page_entries = [e for e in entries if e['page'] == entry['page']]
        position = page_entries.index(entry) / max(1, len(page_entries))
        score = 120 if match else 110 if near_closing else 100 if marker in before[-2:] else 75 if has_role and (signature_region or position > .45) else 0
        context = entry['text'] if match else marker['text'] if marker else ''
        if re.match(r'^(?:prepared|noted|certified|recommending)\b', context, re.I):
            score = 60
        if not score:
            continue
        evidence = '\n'.join(filter(None, [next((e['text'] for e in before if CLOSING.match(e['text'])), ''), entry['text'], following if has_role else '']))
        candidate = {'name': name, 'role': following if has_role else '', 'page': entry['page'], 'line': entry['line'], 'score': score, 'evidence': evidence}
        prior = next((c for c in candidates if c['name'].casefold() == name.casefold()), None)
        if prior is None:
            candidates.append(candidate)
        elif score > prior['score']:
            prior.update(candidate)
    candidates.sort(key=lambda c: (-c['score'], c['page'], c['line']))
    primary = [c for c in candidates if c['score'] == candidates[0]['score']] if candidates else []
    signatory = primary[0] if len(primary) == 1 else None
    def labeled(pattern):
        for i, entry in enumerate(entries):
            if entry['page'] != 1:
                continue
            if CLOSING.match(entry['text']) or re.match(r'^dear\b', entry['text'], re.I):
                break
            match = re.match(pattern, entry['text'], re.I)
            if not match:
                continue
            value = tidy(match.group(1))
            if not value and i + 1 < len(entries):
                following = entries[i + 1]
                if following['page'] == entry['page'] and not FIELD_LABEL.match(following['text']) and not BODY.match(following['text']):
                    value = following['text']
            if value:
                return value
        return ''
    header = parse_header(text)
    sender = header['senderOffice']
    # Only the candidate scorer can supply a signatory; ambiguous names remain blank.
    if sender == header['signatory']:
        sender = signatory['name'] if signatory else ''
    recipient = header['recipient']
    return {'signatory': signatory['name'] if signatory else '', 'signatoryRole': signatory['role'] if signatory else '', 'signatoryCandidates': candidates,
            'receivedFrom': signatory['name'] if signatory else sender if not primary else '', 'sender': sender, 'recipient': recipient,
            'fieldEvidence': {'receivedFrom': signatory['evidence'] if signatory else sender}, 'needsReview': ['receivedFrom'] if len(primary) > 1 else []}
def extract_signatory_text(text):
    return parse_correspondence(text)['signatory']
def parse_date(value):
    for pattern in (r'\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b', r'\b[A-Za-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b', r'\b\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\.?,?\s+\d{4}\b'):
        match = re.search(pattern, value)
        if match:
            cleaned = re.sub(r'(\d)(st|nd|rd|th)\b', r'\1', match.group(), flags=re.I).replace(',', '').replace('.', '')
            for fmt in ('%Y-%m-%d', '%Y/%m/%d', '%B %d %Y', '%b %d %Y', '%d %B %Y', '%d %b %Y'):
                try:
                    return datetime.strptime(cleaned, fmt).date().isoformat()
                except ValueError:
                    pass
    return ''
def parse_header_fields(text):
    lines = str(text or '').split('\f', 1)[0].replace('\r', '').split('\n')
    subject = control = evidence_subject = evidence_control = ''
    control_candidates = []
    for i, raw in enumerate(lines[:120]):
        line = tidy(raw)
        if BODY.match(line) or CLOSING.match(line):
            break
        sm = re.match(r'^(?:SUBJECT(?:\s+MATTER)?|SUBJEC[TIL1]|SUBJ|SUB3ECT|RE)\s*[:：;\-]?\s*(.*)$', line, re.I)
        if sm and not subject:
            parts = [sm.group(1)] if sm.group(1) else []
            for following in lines[i + 1:i + 7]:
                following = tidy(following)
                if not following:
                    if parts:
                        break
                    continue
                if FIELD_LABEL.match(following) or BODY.match(following) or CLOSING.match(following) or SIGN_LABEL.match(following):
                    break
                if parts and re.search(r'[.!?]$', parts[-1]):
                    break
                parts.append(following)
            subject = tidy(' '.join(parts))
            evidence_subject = line
        cm = re.match(r'^(?:(?:DOCUMENT\s+)?(?:CONTROL|TRACKING|REFERENCE|REF\.?|DOCUMENT|DOC\.?)\s*(?:NO\.?|NUMBER|#)|(?:OFFICE\s+)?(?:MEMORANDUM|MEMO|ORDER|CIRCULAR|RESOLUTION)\s*(?:NO\.?|NUMBER|#)|NO\.?|NUMBER)\s*[:#.=\-]?\s*(.*)$', line, re.I)
        if cm:
            value = cm.group(1).strip() or next((tidy(x) for x in lines[i + 1:i + 4] if tidy(x)), '')
            if re.fullmatch(r'[A-Z0-9]+(?:[._/-][A-Z0-9]+)*(?:,?\s*(?:s\.?|series\s+of)\s*[,.:]?\s*(?:19|20)\d{2})?', value, re.I) and re.search(r'\d', value):
                if value not in control_candidates:
                    control_candidates.append(value)
                    evidence_control = line
    if len(control_candidates) == 1:
        control = control_candidates[0]
    return {'subject': subject, 'controlNo': control, 'controlNoCandidates': control_candidates,
            'extractionVersion': 'adaptive-ocr-v6', 'fieldEvidence': {'subject': evidence_subject, 'controlNo': evidence_control},
            'needsReview': ([] if subject else ['subject']) + ([] if control else ['controlNo'])}
# Subject and type rules match the owning Communications module.
LETTER_DETAIL_RULES = {'headings': [['Memorandum',
               {'pattern': '^(?:OFFICE\\s+)?(?:MEMORANDUM|MEM0RANDUM|MEMO)(?:\\s+(?:ORDER|CIRCULAR))?(?:\\s+(?:N[O0]\\.?|NUMBER|FOR|SERIES)\\b.*|\\s*[:#.-]?\\s*\\d.*)?$',
                'flags': 'i'}],
              ['Travel Order',
               {'pattern': '^(?:REVISED\\s+)?TRAVEL\\s+ORDER(?:\\s+(?:N[O0]\\.?|NUMBER|SERIES)\\b.*|\\s*[:#.-]?\\s*\\d.*)?$',
                'flags': 'i'}],
              ['Special Order',
               {'pattern': '^SPECIAL\\s+ORDER(?:\\s+(?:N[O0]\\.?|NUMBER|SERIES)\\b.*|\\s*[:#.-]?\\s*\\d.*)?$',
                'flags': 'i'}],
              ['Office Order',
               {'pattern': '^(?:OFFICE|ADMINISTRATIVE)\\s+ORDER(?:\\s+(?:N[O0]\\.?|NUMBER|SERIES)\\b.*|\\s*[:#.-]?\\s*\\d.*)?$',
                'flags': 'i'}],
              ['Notice of Meeting',
               {'pattern': '^(?:NOTICE\\s+OF\\s+(?:A\\s+)?MEETING|MEETING\\s+NOTICE)(?:\\s*[:\\-].*)?$', 'flags': 'i'}],
              ['Request Letter',
               {'pattern': '^(?:REQUEST\\s+LETTER|LETTER\\s+OF\\s+REQUEST)(?:\\s*[:\\-].*)?$', 'flags': 'i'}],
              ['Endorsement Letter',
               {'pattern': '^(?:ENDORSEMENT(?:\\s+LETTER)?|LETTER\\s+OF\\s+ENDORSEMENT)(?:\\s*[:\\-].*)?$',
                'flags': 'i'}],
              ['Transmittal Letter',
               {'pattern': '^(?:TRANSMITTAL(?:\\s+LETTER)?|LETTER\\s+OF\\s+TRANSMITTAL)(?:\\s*[:\\-].*)?$',
                'flags': 'i'}],
              ['Response Letter', {'pattern': '^(?:RESPONSE|REPLY)\\s+LETTER(?:\\s*[:\\-].*)?$', 'flags': 'i'}],
              ['Invitation',
               {'pattern': '^(?:INVITATION(?:\\s+LETTER)?|LETTER\\s+OF\\s+INVITATION)(?:\\s*[:\\-].*)?$',
                'flags': 'i'}],
              ['Report',
               {'pattern': '^(?:(?:MONTHLY|ANNUAL|ACCOMPLISHMENT|ACTIVITY|INSPECTION|PROGRESS|INCIDENT|NARRATIVE)\\s+){0,2}REPORT(?:\\s*[:\\-].*)?$',
                'flags': 'i'}]],
 'subjectRules': [['Request Letter',
                   {'pattern': '(?:^(?:REQUEST(?:ING)?(?:\\s+(?:FOR|TO))?|APPLICATION\\s+FOR|REQUISITION\\s+FOR|PURCHASE\\s+REQUEST)\\b|\\b(?:EQUIPMENT|SUPPLY|SUPPLIES|FUNDING|ASSISTANCE|PURCHASE|PERMISSION|APPROVAL|DOCUMENT|RECORDS|FINANCIAL|BUDGET|SPONSORSHIP)\\s+REQUEST\\b)',
                    'flags': 'i'}],
                  ['Notice of Meeting',
                   {'pattern': '^(?:NOTICE\\s+OF\\s+(?:A\\s+)?MEETING|MEETING\\s+NOTICE|(?:STAFF|PERSONNEL|COORDINATION|REGULAR|SPECIAL)\\s+MEETING)\\b',
                    'flags': 'i'}],
                  ['Invitation', {'pattern': '^INVITATION\\b', 'flags': 'i'}],
                  ['Endorsement Letter', {'pattern': '^ENDORSEMENT\\b', 'flags': 'i'}],
                  ['Transmittal Letter',
                   {'pattern': '^(?:TRANSMITTAL\\b|(?:SUBMISSION|FORWARDING)\\s+OF\\b)', 'flags': 'i'}],
                  ['Response Letter', {'pattern': '^(?:RESPONSE|REPLY)\\s+TO\\b', 'flags': 'i'}],
                  ['Report',
                   {'pattern': '^(?:(?:MONTHLY|ANNUAL|ACCOMPLISHMENT|ACTIVITY|INSPECTION|PROGRESS|INCIDENT|NARRATIVE)\\s+){0,2}REPORT\\b',
                    'flags': 'i'}]],
 'bodyRules': [['Response Letter',
                {'pattern': '\\b(?:in\\s+(?:response|reply)\\s+to|respond(?:ing)?\\s+to|reply(?:ing)?\\s+to)\\b',
                 'flags': 'i'}],
               ['Invitation',
                {'pattern': '\\b(?:invite\\s+(?:you|your|the)|inviting\\s+(?:you|your|the)|extend\\s+(?:an?|our)\\s+invitation)\\b',
                 'flags': 'i'}],
               ['Endorsement Letter',
                {'pattern': '\\b(?:(?:we|I)\\s+(?:(?:hereby|respectfully)\\s+)?endorse|endorsing\\s+(?:the|this|Mr|Ms|Dr))\\b',
                 'flags': 'i'}],
               ['Transmittal Letter',
                {'pattern': '\\b(?:(?:we|I)\\s+(?:(?:hereby|respectfully|are)\\s+)?(?:transmit|forward|submit|transmitting|forwarding|submitting)|herewith\\s+(?:transmitted|submitted|forwarded)|transmittal\\s+of)\\b',
                 'flags': 'i'}],
               ['Request Letter',
                {'pattern': '\\b(?:request(?:ing)?\\s+(?:for|to|your|the|a|an|permission|approval|assistance|funding|technical\\s+assistance)|application\\s+for)\\b',
                 'flags': 'i'}],
               ['Notice of Meeting',
                {'pattern': '\\b(?:please\\s+be\\s+informed|inform\\s+(?:you|all)|notify\\s+(?:you|all))\\b[^.!?]{0,180}\\bmeeting\\b',
                 'flags': 'i'}],
               ['Report',
                {'pattern': '\\b(?:report\\s+on|(?:monthly|annual|accomplishment|activity|inspection|progress|incident)\\s+report)\\b',
                 'flags': 'i'}]],
 'subjectLabel': {'pattern': '^(?:SUBJECT(?:\\s+(?:MATTER|OF\\s+(?:THE\\s+)?LETTER))?|SUBJEC[TIL1]|SUB3ECT|SUBJ\\.?|RE|REGARDING|PAKSA)(?:\\s*[:;\\-–—]\\s*|\\s+|$)(.*)$',
                  'flags': 'i'},
 'fieldLabel': {'pattern': '^(?:DATE(?:\\s+(?:ISSUED|RECEIVED|RELEASED))?|DATED|TO|T0|FOR|FROM|SENDER|THRU|THROUGH|CC|ATTACHMENTS?|ENCLOSURES?|REFERENCE|REF\\.?|CONTROL(?:\\s+(?:NO\\.?|NUMBER))?|ISSUED\\s+BY|SIGNATORY|REMARKS|N[O0]\\.?|NUMBER)\\s*[:;\\-]',
                'flags': 'i'},
 'salutation': {'pattern': "^(?:DEAR\\b|SIR\\s*[,!:]|MADAM\\s*[,!:]|MA'AM\\s*[,!:]|TO\\s+WHOM\\s+IT\\s+MAY\\s+CONCERN)",
                'flags': 'i'},
 'closing': {'pattern': '^(?:(?:VERY\\s+)?(?:YOURS\\s+)?(?:SINCERELY|RESPECTFULLY|FAITHFULLY|TRULY)|YOURS\\s+(?:TRULY|FAITHFULLY|SINCERELY)|BEST\\s+REGARDS|KIND\\s+REGARDS|LUBOS\\s+NA\\s+GUMAGALANG|SIGNED\\s+BY|PREPARED\\s+BY|APPROVED\\s+BY)\\b',
             'flags': 'i'},
 'body': {'pattern': '^(?:DEAR\\b|GREETINGS\\b|GOOD\\s+(?:DAY|MORNING|AFTERNOON)\\b|PLEASE\\b|KINDLY\\b|WE\\b|I\\s+(?:AM|WOULD|HEREBY|WRITE|RESPECTFULLY)\\b|MAY\\s+(?:WE|I)\\b|THIS\\s+(?:IS|LETTER|REFERS|HAS|WILL)\\b|YOU\\s+ARE\\b|THE\\s+(?:UNDERSIGNED|ATTACHED|PURPOSE)\\b|ATTACHED\\s+(?:IS|ARE|HEREWITH)\\b|IN\\s+(?:CONNECTION|VIEW|LIGHT)\\b|WITH\\s+REFERENCE\\b|PURSUANT\\b|FOR\\s+YOUR\\s+(?:INFORMATION|COMPLIANCE|GUIDANCE)\\b)',
          'flags': 'i'},
 'titlePurpose': {'pattern': '^(?:REQUEST\\s+(?:FOR|TO)|INVITATION\\s+(?:TO|FOR)|ENDORSEMENT\\s+(?:OF|FOR)|TRANSMITTAL\\s+OF|RESPONSE\\s+TO|REPLY\\s+TO|NOTICE\\s+OF\\s+MEETING|(?:MONTHLY|ANNUAL|ACCOMPLISHMENT|ACTIVITY|INSPECTION|PROGRESS|INCIDENT)\\s+REPORT)\\b',
                  'flags': 'i'}}

def parse_letter_details(raw_text=''):
    """Extract printed subjects; label body-derived suggestions for review."""
    first = str(raw_text or '').replace('\r', '').split('\f', 1)[0].replace('：', ':').replace('；', ';')
    layout = re.sub(r'[ \t|]{2,}(?=(?:SUBJECT|SUBJ|RE|DATE|TO|FROM|THRU|CONTROL\s+(?:NO\.?|NUMBER))\s*[:;])', '\n', first, flags=re.I)
    lines = [re.sub(r'^\|(?=\s+respectfully\b)', 'I', tidy(line), flags=re.I) for line in layout.split('\n')]
    pattern = lambda key: re.compile(LETTER_DETAIL_RULES[key]['pattern'], re.I)
    subject_label, field_label = pattern('subjectLabel'), pattern('fieldLabel')
    salutation, closing, body = pattern('salutation'), pattern('closing'), pattern('body')
    title_purpose = pattern('titlePurpose')
    subject, subject_source, subject_evidence = '', 'none', ''
    subject_start = subject_end = -1
    greeting_seen, header = False, []
    for i, line in enumerate(lines[:120]):
        if not line:
            continue
        if closing.search(line):
            break
        match = subject_label.search(line)
        if match and not subject:
            subject_start = subject_end = i
            parts = [re.sub(r'^[:;|\s]+', '', match.group(1))] if match.group(1) else []
            gap = 0
            for j in range(i + 1, min(len(lines), i + 15)):
                if len(parts) >= 8:
                    break
                following = lines[j]
                if not following:
                    if not parts and gap < 2:
                        gap += 1
                        continue
                    k = j + 1
                    while k < len(lines) and not lines[k]:
                        k += 1
                    continuation = re.search(r'\b(?:FOR|OF|ON|AND|OR|WITH|REGARDING|DURING|TO)$', parts[-1] if parts else '')
                    if k < len(lines) and k - j <= 2 and (continuation or re.search(r'^(?:FOR|OF|ON|AND|OR|WITH|REGARDING|DURING)\b', lines[k])):
                        continue
                    break
                if not parts and re.fullmatch(r'[:;|\-]+', following):
                    continue
                if any(p.search(following) for p in (subject_label, field_label, salutation, closing, body)) or re.match(r'^\d+[.)]\s|^[-_=]{3,}$', following):
                    break
                if len(' '.join(parts)) + len(following) > 600:
                    break
                parts.append(following)
                subject_end = j
            subject = tidy(' '.join(parts))
            subject_source = 'printed' if subject else 'none'
            subject_evidence = line if subject else ''
        if salutation.search(line):
            greeting_seen = True
            continue
        if body.search(line):
            break
        if not greeting_seen:
            header.append(line)
    if not subject:
        title = next((line for line in header if title_purpose.search(line)), '')
        if title:
            subject, subject_source, subject_evidence = title, 'heading', title
    greeting_index = next((i for i, line in enumerate(lines) if salutation.search(line)), -1)
    opening = ''
    if greeting_index >= 0:
        parts = []
        for i in range(greeting_index + 1, min(len(lines), greeting_index + 23)):
            line = lines[i]
            if not line:
                if parts:
                    break
                continue
            if closing.search(line):
                break
            if subject_start <= i <= subject_end or subject_label.search(line) or field_label.search(line) or re.fullmatch(r'(?:GREETINGS|GOOD\s+(?:DAY|MORNING|AFTERNOON))[!.]*', line, re.I):
                continue
            parts.append(line)
            if len(' '.join(parts)) >= 650:
                break
        opening = tidy(' '.join(parts))
    else:
        opening = next((line for line in lines if body.search(line) and not salutation.search(line)), '')
    if not subject and opening and re.search(r'\b(?:request(?:ing)?|invite|invitation|endorse|endorsement|transmit|transmittal|submit|forward|respond|response|reply|inform|report)\b', opening, re.I):
        match = re.match(r'^.*?[.!?](?=\s+[A-Z]|$)', opening)
        sentence = match.group(0) if match else opening
        subject = sentence if len(sentence) <= 240 else re.sub(r'\s+\S*$', '', sentence[:240]) + '…'
        subject_source, subject_evidence = 'body', sentence
    document_type, type_source, type_evidence = '', 'none', ''
    for type_name, rule in LETTER_DETAIL_RULES['headings']:
        found = next((line for line in header if re.search(rule['pattern'], re.sub(r'^DOCUMENT\s+TYPE\s*[:\-]\s*', '', line, flags=re.I), re.I)), '')
        if found:
            document_type, type_source, type_evidence = type_name, 'heading', found
            break
    if not document_type and subject_source != 'body':
        for type_name, rule in LETTER_DETAIL_RULES['subjectRules']:
            if re.search(rule['pattern'], subject, re.I):
                document_type, type_source, type_evidence = type_name, 'subject', subject
                break
    if not document_type:
        for type_name, rule in LETTER_DETAIL_RULES['bodyRules']:
            if re.search(rule['pattern'], opening, re.I):
                document_type, type_source, type_evidence = type_name, 'body', opening
                break
    if not document_type and str(raw_text or '').strip():
        document_type, type_source = ('Letter' if greeting_index >= 0 else 'Other Communication'), 'fallback'
    return {'subject': subject, 'subjectSource': subject_source, 'subjectEvidence': subject_evidence,
            'documentType': document_type, 'documentTypeSource': type_source, 'documentTypeEvidence': type_evidence,
            'needsReview': (['subject'] if subject_source == 'body' or not subject else []) + (['documentType'] if type_source in ('fallback', 'body', 'subject') else [])}
def extract_document_metadata(text, numeric_text='', numeric_tokens=None):
    header = parse_header(text)
    details = parse_letter_details(text)
    sender = parse_correspondence(text)
    result = {**header, **sender, 'subject': header['subject'] or details['subject'], 'subjectSource': 'header' if header['subject'] else details['subjectSource'],
              'documentType': header['documentType'] or details['documentType'], 'documentTypeSource': 'heading' if header['documentType'] else details['documentTypeSource'], 'issuedBy': sender['sender'] or sender['signatory'],
              'sourceOffice': sender['sender'], 'detectedNumbers': numeric_tokens or extract_numeric_tokens(text),
              'fieldEvidence': {**header['fieldEvidence'], **sender['fieldEvidence'], 'subject': details['subjectEvidence'], 'documentType': details['documentTypeEvidence']},
              'needsReview': list(dict.fromkeys([key for key in header['needsReview'] if key != 'subject'] + details['needsReview'] + sender['needsReview'] + ([] if sender['receivedFrom'] else ['receivedFrom'])))}
    return result
def extract_numeric_tokens(text):
    return list(dict.fromkeys(re.findall(r'(?<!\w)\d[\d,./:-]*', text or '')))

def run_tesseract(image, psm=3, with_data=False, whitelist=''):
    """Get text and word confidence in ONE engine invocation."""
    remaining = check_budget()
    if not _ocr_slots.acquire(timeout=remaining):
        raise DocumentTimeout('OCR is busy. Please try again after the current document finishes.')
    try:
        timeout = min(OCR_TIMEOUT, check_budget())
        with tempfile.TemporaryDirectory(prefix='pgenro_ocr_') as folder:
            path, output = Path(folder) / 'page.pgm', Path(folder) / 'result'
            # PGM avoids PNG compression before every engine call.
            image.convert('L').save(path, 'PPM')
            command = [TESSERACT_CMD, str(path), str(output), '-l', OCR_LANG,
                       '--oem', '3', '--psm', str(psm), '--dpi', str(OCR_DPI),
                       '-c', 'preserve_interword_spaces=1']
            if whitelist:
                command += ['-c', 'tessedit_char_whitelist=' + whitelist]
            command += ['txt', 'tsv']
            environment = os.environ.copy()
            environment.setdefault('OMP_THREAD_LIMIT', '1')
            current = _state.get()
            if current:
                with current.lock:
                    current.passes += 1
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=environment)
            page_deadline = time.monotonic() + timeout
            try:
                while True:
                    check_budget()
                    left = page_deadline - time.monotonic()
                    if left <= 0:
                        raise subprocess.TimeoutExpired(command, timeout)
                    try:
                        _, stderr = process.communicate(timeout=min(.2, left))
                        break
                    except subprocess.TimeoutExpired:
                        continue
            finally:
                if process.poll() is None:
                    process.kill()
                    process.communicate()
            if process.returncode:
                raise RuntimeError(stderr.decode('utf-8', errors='replace').strip() or 'Tesseract could not read the image.')
            text = clean_text(output.with_suffix('.txt').read_text(encoding='utf-8', errors='replace').rstrip('\f \t\r\n'))
            rows = []
            for row in csv.DictReader(io.StringIO(output.with_suffix('.tsv').read_text(encoding='utf-8', errors='replace')), delimiter='\t'):
                try:
                    confidence = float(row.get('conf', -1))
                except (ValueError, TypeError):
                    continue
                if confidence >= 0 and str(row.get('text', '')).strip():
                    rows.append({**row, 'conf': confidence})
            weights = [max(1, len(row['text'])) for row in rows]
            confidence = sum(row['conf'] * weight for row, weight in zip(rows, weights)) / max(1, sum(weights))
            data = {'text': text, 'confidence': round(confidence, 2), 'words': rows}
            return data if with_data else text
    finally:
        _ocr_slots.release()

def opaque_image(image):
    image = ImageOps.exif_transpose(image)
    if image.mode in ('RGBA', 'LA') or 'transparency' in image.info:
        rgba = image.convert('RGBA')
        background = Image.new('RGB', image.size, 'white')
        background.paste(rgba, mask=rgba.getchannel('A'))
        return background
    return image.convert('RGB')

def preprocess_image_for_ocr(image):
    image = opaque_image(image)
    if image.width < 1600:
        scale = min(3, 1600 / image.width, OCR_MAX_SIDE / max(image.size))
    else:
        scale = min(1, OCR_MAX_SIDE / max(image.size))
    if abs(scale - 1) > .01:
        image = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)
    gray = ImageOps.grayscale(image)
    # White letters on a dark background become dark letters on white.
    if ImageStat.Stat(gray.resize((64, 64))).mean[0] < 110:
        gray = ImageOps.invert(gray)
    return ImageEnhance.Contrast(ImageOps.autocontrast(gray, cutoff=1)).enhance(1.3)

def text_score(text):
    # Coverage matters more than the presence of header keywords.
    words = re.findall(r'\w+', text)
    return len(words) + len(set(w.casefold() for w in words)) * .2 + (20 if extract_signatory_text(text) else 0)

def signature_top(data, height):
    lines = {}
    for word in data.get('words', []):
        key = (word.get('block_num'), word.get('par_num'), word.get('line_num'))
        lines.setdefault(key, []).append(word)
    markers = []
    for words in lines.values():
        line = ' '.join(word['text'] for word in words)
        if CLOSING.match(line) or SIGN_LABEL.match(line):
            markers.append(min(int(word['top']) for word in words))
    return max(0, min(markers) - 30) if markers else round(height * .45)

def recover_scanned_signatory(image, top=None):
    """Retry the signature area; remove blue ink with PIL's C-level operations."""
    image = opaque_image(image)
    top = round(image.height * .45) if top is None else max(0, min(image.height - 1, int(top)))
    crop = image.crop((0, top, image.width, image.height))
    crop.thumbnail((2200, 2200), Image.Resampling.LANCZOS)
    red, green, blue = crop.split()
    positive = lambda channel: channel.point(lambda value: 255 if value > 0 else 0)
    mask = ImageChops.multiply(positive(ImageChops.subtract(blue, red.point(lambda v: min(255, round(v * 1.25))))),
                               positive(ImageChops.subtract(blue, green.point(lambda v: min(255, round(v * 1.18))))))
    mask = ImageChops.multiply(mask, ImageChops.subtract(blue, red).point(lambda v: 255 if v > 12 else 0))
    gray = ImageOps.grayscale(crop)
    gray.paste(255, mask=mask)
    result = run_tesseract(preprocess_image_for_ocr(gray), 6, with_data=True)
    return result['text'] if parse_correspondence(result['text'], signature_region=True)['signatoryCandidates'] else ''

def merge_missing(base, extra):
    """Keep the chosen full-page text; supplement only missing OCR lines."""
    base = clean_text(base)
    keys = {re.sub(r'\W+', '', line.casefold()) for line in base.splitlines() if line.strip()}
    additions = []
    for line in clean_text(extra).splitlines():
        key = re.sub(r'\W+', '', line.casefold())
        if key and key not in keys:
            additions.append(line)
            keys.add(key)
    return base + ('\n\n' + '\n'.join(additions) if additions else '')

def fast_ocr_image(image, header_metadata=None):
    image = opaque_image(image)
    processed = preprocess_image_for_ocr(image)
    if processed.getextrema()[1] - processed.getextrema()[0] < 8:
        return ''
    first = run_tesseract(processed, 3, with_data=True)
    chosen = first
    words = re.findall(r'\w+', first['text'])
    # Clean letters normally stop here. Retry only weak text or coverage.
    if len(words) < 12 or first['confidence'] < OCR_MIN_CONFIDENCE:
        try:
            # Automatic orientation detection recovers sideways and upside-down scans.
            alternate = run_tesseract(processed, 1, with_data=True)
            if text_score(alternate['text']) > text_score(first['text']):
                chosen = alternate
            elif alternate['confidence'] > first['confidence'] and len(alternate['text']) >= len(first['text']) * .85:
                chosen = alternate
            if not extract_signatory_text(chosen['text']) and extract_signatory_text(alternate['text']):
                chosen = {**chosen, 'text': merge_missing(chosen['text'], alternate['text'])}
        except subprocess.TimeoutExpired:
            if not chosen['text'].strip():
                raise
            warn('An optional layout retry timed out. Review the detected text against the original.')
    text = chosen['text']
    lines = text.splitlines()
    has_signature_hint = any(CLOSING.match(line) or SIGN_LABEL.match(line) for line in lines) or any(ROLE.search(line) or name_value(line) for line in lines[round(len(lines) * .55):])
    if text and not parse_correspondence(text)['receivedFrom'] and has_signature_hint:
        try:
            # Convert word coordinates from processed image back to source pixels.
            top = signature_top(chosen, processed.height) * image.height / processed.height
            recovered = recover_scanned_signatory(image, top)
            if recovered:
                text = merge_missing(text, recovered)
        except subprocess.TimeoutExpired:
            warn('The signature retry timed out. Check Received From manually.')
    if chosen['confidence'] < OCR_MIN_CONFIDENCE:
        warn('Some scanned text has low confidence. Review the fields and extracted text before saving.')
    current = _state.get()
    if current:
        with current.lock:
            current.confidences.append(chosen['confidence'])
    if header_metadata is not None:
        fields = parse_header_fields(text)
        if fields['subject']:
            header_metadata.update({'subject': fields['subject'], 'subjectEvidence': fields['fieldEvidence']['subject']})
    return text

def image_has_uncovered_text(page, native):
    """Keep genuine text layers; OCR large image areas with no overlapping text."""
    if len(native.strip()) < 40 or '\ufffd' in native:
        return True
    blocks = [fitz.Rect(block[:4]) for block in page.get_text('blocks') if block[6] == 0 and str(block[4]).strip()]
    area = max(1, page.rect.get_area())
    for info in page.get_image_info():
        rect = fitz.Rect(info['bbox'])
        if rect.get_area() / area <= .10:
            continue
        overlap = sum((rect & block).get_area() for block in blocks)
        covered = overlap / max(1, rect.get_area())
        # A header over a page scan is insufficient; a distributed text layer is usable.
        band_count = sum(any((rect & block).get_area() > 0 and rect.y0 + rect.height * band / 3 <= (block.y0 + block.y1) / 2 < rect.y0 + rect.height * (band + 1) / 3 for block in blocks) for band in range(3))
        if covered < .015 or band_count < 2:
            return True
    return False

def ordered_ocr(jobs, output):
    """Await OCR in page order. Only PIL/Tesseract work runs in worker threads."""
    if not jobs:
        return
    number, native, future = jobs.pop(0)
    scanned = future.result(timeout=check_budget())
    output[number] = merge_missing(scanned, native) if scanned and native else scanned or native

def extract_pdf(file_path, header_metadata=None):
    jobs = []
    with fitz.open(file_path) as document:
        if document.needs_pass:
            raise ValueError('This PDF is password protected. Upload an unlocked copy.')
        output = [''] * len(document)
        try:
            for number, page in enumerate(document):
                check_budget()
                native = clean_text(page.get_text('text', sort=True))
                if not image_has_uncovered_text(page, native):
                    output[number] = native
                    continue
                # Render on the calling thread: PyMuPDF objects are never shared across threads.
                scale = min(OCR_DPI / 72, OCR_MAX_SIDE / max(page.rect.width, page.rect.height))
                pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csRGB, alpha=False)
                image = Image.frombytes('RGB', (pixmap.width, pixmap.height), pixmap.samples)
                context = contextvars.copy_context()
                future = _pool.submit(context.run, fast_ocr_image, image, header_metadata if number == 0 else None)
                jobs.append((number, native, future))
                if len(jobs) >= OCR_WORKERS:
                    ordered_ocr(jobs, output)
            while jobs:
                ordered_ocr(jobs, output)
        finally:
            for _, _, future in jobs:
                future.cancel()
    return '\n\f\n'.join(output)

def xml_text(data, paragraph_tags=('p',)):
    root = ET.fromstring(data)
    paragraphs = []
    for element in root.iter():
        if element.tag.rsplit('}', 1)[-1] in paragraph_tags:
            parts = []
            for node in element.iter():
                local = node.tag.rsplit('}', 1)[-1]
                if local in ('t', 'instrText') and node.text:
                    parts.append(node.text)
                elif local in ('br', 'cr', 'tab'):
                    parts.append(' ')
            if tidy(''.join(parts)):
                paragraphs.append(''.join(parts))
    return '\n'.join(paragraphs)
def office_archive(file_path, extension):
    output, warnings = [], []
    with zipfile.ZipFile(file_path) as archive:
        if sum(i.file_size for i in archive.infolist()) > 300 * 1024 * 1024:
            raise ValueError('The expanded document is too large to read.')
        names = archive.namelist()
        if extension == 'docx':
            headers = sorted(n for n in names if re.fullmatch(r'word/header\d+\.xml', n))
            footers = sorted(n for n in names if re.fullmatch(r'word/footer\d+\.xml', n))
            parts = headers + ['word/document.xml'] + footers
            parts += [n for n in ('word/footnotes.xml', 'word/endnotes.xml') if n in names]
        else:
            parts = sorted((n for n in names if re.fullmatch(r'ppt/slides/slide\d+\.xml', n)), key=lambda n: int(re.search(r'(\d+)\.xml$', n).group(1)))
            parts += sorted(n for n in names if re.fullmatch(r'ppt/notesSlides/notesSlide\d+\.xml', n))
        for part in parts:
            if part in names:
                if part == 'word/document.xml':
                    def embedded_reader(content):
                        check_budget()
                        with Image.open(io.BytesIO(content)) as image:
                            return fast_ocr_image(image) if image.width >= 400 and image.height >= 200 else ''
                    output.append(docx_text(file_path, embedded_reader))
                else:
                    output.append(xml_text(archive.read(part)))
        # Read embedded scanned letters as well as editable document text.
        prefix = 'word/media/' if extension == 'docx' else 'ppt/media/'
        for name in names:
            if extension != 'docx' and name.startswith(prefix) and Path(name).suffix.lower() in ('.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff', '.webp'):
                try:
                    with Image.open(io.BytesIO(archive.read(name))) as image:
                        if image.width >= 400 and image.height >= 200:
                            output.append(fast_ocr_image(image))
                except Exception as error:
                    warnings.append(f'An embedded image could not be read: {error}')
    return ('\n\n' if extension == 'docx' else '\n\f\n').join(output), warnings
def extract_xlsx(file_path):
    with zipfile.ZipFile(file_path) as archive:
        if sum(i.file_size for i in archive.infolist()) > 300 * 1024 * 1024:
            raise ValueError('The expanded workbook is too large to read.')
        names = archive.namelist()
        strings = []
        if 'xl/sharedStrings.xml' in names:
            root = ET.fromstring(archive.read('xl/sharedStrings.xml'))
            strings = [''.join(node.text or '' for node in item.iter() if node.tag.rsplit('}', 1)[-1] == 't') for item in root]
        output = []
        for name in sorted(n for n in names if re.fullmatch(r'xl/worksheets/sheet\d+\.xml', n)):
            rows = []
            root = ET.fromstring(archive.read(name))
            for row in root.iter():
                if row.tag.rsplit('}', 1)[-1] != 'row':
                    continue
                values = []
                for cell in row:
                    value = next((n.text or '' for n in cell if n.tag.rsplit('}', 1)[-1] == 'v'), '')
                    if cell.get('t') == 's' and value.isdigit():
                        value = strings[int(value)] if int(value) < len(strings) else value
                    elif cell.get('t') == 'inlineStr':
                        value = ''.join(n.text or '' for n in cell.iter() if n.tag.rsplit('}', 1)[-1] == 't')
                    values.append(value)
                rows.append(' | '.join(values))
            output.append('\n'.join(rows))
        return '\n\f\n'.join(output)
def read_document(file_path, extension):
    warnings = []
    if extension == 'pdf':
        text = extract_pdf(file_path)
    elif extension in {'png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff'}:
        pages, jobs = [], []
        try:
            with Image.open(file_path) as source:
                for number, frame in enumerate(ImageSequence.Iterator(source)):
                    check_budget()
                    pages.append('')
                    context = contextvars.copy_context()
                    jobs.append((number, '', _pool.submit(context.run, fast_ocr_image, frame.copy())))
                    if len(jobs) >= OCR_WORKERS:
                        ordered_ocr(jobs, pages)
                while jobs:
                    ordered_ocr(jobs, pages)
        finally:
            for _, _, future in jobs:
                future.cancel()
        text = '\n\f\n'.join(pages)
    elif extension in {'docx', 'pptx'}:
        text, warnings = office_archive(file_path, extension)
    elif extension == 'xlsx':
        text = extract_xlsx(file_path)
    elif extension in {'txt', 'csv'}:
        content = Path(file_path).read_bytes()
        text = content.decode('utf-16' if content[:2] in (b'\xff\xfe', b'\xfe\xff') else 'utf-8-sig', errors='replace')
    else:
        raise ValueError(f'File type .{extension} is not supported.')
    text = clean_text(text)
    return {'text': text, 'metadata': extract_document_metadata(text), 'warnings': warnings, 'pages': text.count('\f') + 1}

# Numeric tokens come from the already-read full text by default.
# OCR_NUMERIC_PASS=1 adds ONE header-only numeric pass, never 12 passes per page.
NUMERIC_WHITELIST = '0123456789-/.#:,()'
NUMERIC_OCR_ENABLED = OCR_NUMERIC_ENABLED

def numeric_ocr_image(image):
    header = opaque_image(image)
    header = header.crop((0, 0, header.width, max(1, round(header.height * .35))))
    data = run_tesseract(preprocess_image_for_ocr(header), 6, with_data=True, whitelist=NUMERIC_WHITELIST)
    return {'text': data['text'], 'tokens': extract_numeric_tokens(data['text']), 'confidence': data['confidence']}

def numeric_document(file_path, extension, full_text):
    numbers = {'text': '', 'tokens': extract_numeric_tokens(full_text), 'confidence': 0}
    warnings = []
    if not NUMERIC_OCR_ENABLED:
        return numbers, warnings
    try:
        result = None
        if extension == 'pdf':
            with fitz.open(file_path) as document:
                if len(document):
                    page = document[0]
                    if image_has_uncovered_text(page, clean_text(page.get_text('text', sort=True))):
                        scale = min(OCR_DPI / 72, OCR_MAX_SIDE / max(page.rect.width, page.rect.height))
                        pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csRGB, alpha=False)
                        result = numeric_ocr_image(Image.frombytes('RGB', (pixmap.width, pixmap.height), pixmap.samples))
        elif extension in {'png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff'}:
            with Image.open(file_path) as source:
                result = numeric_ocr_image(source.copy())
        if result:
            numbers = {**result, 'tokens': list(dict.fromkeys(numbers['tokens'] + result['tokens']))}
    except subprocess.TimeoutExpired:
        warnings.append('The optional numeric retry timed out. Numbers from the full text were kept.')
    return numbers, warnings

def process_uploaded_file(uploaded_file, request_id=''):
    """Validate and process a Flask/Werkzeug upload; return a JSON body and status."""
    started = time.monotonic()
    token = None
    state = None
    if uploaded_file is None or not getattr(uploaded_file, 'filename', ''):
        return {'success': False, 'error': 'No file received.'}, 400
    filename = Path(uploaded_file.filename.replace('\\', '/')).name
    extension = Path(filename).suffix.lower().lstrip('.')
    if extension not in ALLOWED_EXTENSIONS:
        return {'success': False, 'error': f'File type .{extension} is not supported.'}, 415
    try:
        state = ReadState()
        with _reads_lock:
            if request_id:
                if request_id in _active_reads:
                    return {'success': False, 'error': 'This document request is already running.'}, 409
                if _cancelled_reads.pop(request_id, None) is not None:
                    return {'success': False, 'error': 'The document read was stopped.'}, 409
                _active_reads[request_id] = state
        token = _state.set(state)
        # Limit the stream before saving. Multipart overhead is allowed separately.
        content = uploaded_file.stream.read(MAX_BYTES + 1)
        if len(content) > MAX_BYTES:
            return {'success': False, 'error': 'Choose a file no larger than 50 MB.'}, 413
        if not content:
            return {'success': False, 'error': 'The uploaded file is empty.'}, 422
        key = extension + ':' + hashlib.sha256(content).hexdigest()
        existing = cached_result(key)
        if existing is not None:
            check_budget()
            duration = round((time.monotonic() - started) * 1000)
            existing.update(filename=filename, cacheHit=True, durationMs=duration, processingMs=duration,
                            readingStats={'ocrPasses': 0}, performance={**existing['performance'], 'tesseractPasses': 0})
            return existing, 200
        with tempfile.TemporaryDirectory(prefix='PGENRO_OCR_UPLOAD_') as folder:
            path = Path(folder) / ('document.' + extension)
            path.write_bytes(content)
            result = read_document(path, extension)
            if not result['text'].strip():
                return {'success': False, 'error': 'No readable text detected. Use a clearer scan or enter the details manually.'}, 422
            numbers, numeric_warnings = numeric_document(path, extension, result['text'])
        result['warnings'].extend(numeric_warnings)
        result['warnings'] = list(dict.fromkeys(result['warnings'] + state.warnings))
        result['metadata']['detectedNumbers'] = numbers['tokens']
        check_budget()
        duration = round((time.monotonic() - started) * 1000)
        payload = {'success': True, 'filename': filename, 'characters': len(result['text']), 'numericText': numbers['text'],
                   'numericConfidence': numbers['confidence'], 'detectedNumbers': numbers['tokens'], **result,
                   'durationMs': duration, 'processingMs': duration, 'readingStats': {'ocrPasses': state.passes}, 'cacheHit': False, 'engine': 'local-tesseract',
                   'performance': {'tesseractPasses': state.passes, 'workers': OCR_WORKERS,
                                   'confidence': round(statistics.mean(state.confidences), 2) if state.confidences else None}}
        cache_result(key, payload)
        return payload, 200
    except (ValueError, zipfile.BadZipFile, ET.ParseError, fitz.FileDataError, UnidentifiedImageError) as error:
        return {'success': False, 'error': str(error)}, 400
    except FileNotFoundError:
        return {'success': False, 'error': 'Tesseract is missing. Check the installation and TESSERACT_CMD path.'}, 503
    except subprocess.TimeoutExpired:
        return {'success': False, 'error': 'A page took too long to read. Use a smaller, clearer scan.'}, 504
    except ReadCancelled as error:
        return {'success': False, 'error': str(error)}, 409
    except (DocumentTimeout, TimeoutError) as error:
        return {'success': False, 'error': str(error) or 'The document reached the OCR time limit. Split it into smaller files.'}, 504
    except Exception as error:
        return {'success': False, 'error': str(error)}, 500
    finally:
        with _reads_lock:
            if request_id and _active_reads.get(request_id) is state:
                _active_reads.pop(request_id, None)
        if token is not None:
            _state.reset(token)
# Preserve the supplied server's Flask application and /health + /ocr API.
try:
    from flask import Flask, request, jsonify
    from flask_cors import CORS
except ImportError:
    Flask = request = jsonify = CORS = None
app = Flask(__name__) if Flask else None
if app is not None:
    app.config['MAX_CONTENT_LENGTH'] = MAX_BYTES + 1024 * 1024
    CORS(app, resources={r'/*': {'origins': os.getenv('OCR_ALLOWED_ORIGIN', '*')}})
    @app.after_request
    def local_network_headers(response):
        response.headers['Access-Control-Allow-Private-Network'] = 'true'
        return response
    @app.route('/health', methods=['GET'])
    def health():
        with _reads_lock:
            active = len(_active_reads)
        return jsonify({'ok': True, 'success': True, 'service': 'PGENRO Flask Full Document OCR', 'version': 7, 'fullDocument': True, 'activeReads': active,
                        'formats': sorted(ALLOWED_EXTENSIONS), 'numeric_ocr': NUMERIC_OCR_ENABLED,
                        'workers': OCR_WORKERS, 'dpi': OCR_DPI, 'adaptive': True, 'documentTimeoutSeconds': OCR_DOCUMENT_TIMEOUT, 'tesseractAvailable': bool(shutil.which(TESSERACT_CMD) or Path(TESSERACT_CMD).is_file())}), 200
    @app.route('/ocr', methods=['POST'])
    def run_ocr():
        request_id = request.headers.get('X-OCR-Request-ID', '')
        if request_id and not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', request_id):
            return jsonify({'success': False, 'error': 'Invalid document request ID.'}), 400
        payload, status = process_uploaded_file(request.files.get('file'), request_id)
        return jsonify(payload), status
    @app.route('/cancel', methods=['POST'])
    def cancel_read():
        body = request.get_json(silent=True) or {}
        request_id = body.get('requestId', '') if isinstance(body, dict) else ''
        if not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', request_id):
            return jsonify({'success': False, 'error': 'Invalid document request ID.'}), 400
        with _reads_lock:
            now = time.monotonic()
            for key, created in list(_cancelled_reads.items()):
                if now - created > OCR_DOCUMENT_TIMEOUT:
                    _cancelled_reads.pop(key, None)
            if request_id in _active_reads:
                _active_reads[request_id].cancelled.set()
            else:
                _cancelled_reads[request_id] = now
                while len(_cancelled_reads) > 100:
                    _cancelled_reads.popitem(last=False)
        return jsonify({'success': True, 'requestId': request_id}), 200
    @app.errorhandler(413)
    def file_too_large(error):
        return jsonify({'success': False, 'error': 'Choose a file no larger than 50 MB.'}), 413
def main():
    if app is None:
        raise SystemExit('Flask dependencies are missing. Run START_OCR.bat, or install requirements-ocr.txt using this Python interpreter.')
    # Render injects PORT. Bind publicly there; keep localhost defaults for local OCR use.
    host = os.getenv('OCR_HOST') or ('0.0.0.0' if os.getenv('PORT') else '127.0.0.1')
    port = int(os.getenv('PORT') or os.getenv('OCR_PORT', '5000'))
    print(f'[PGENRO FLASK OCR] http://{host}:{port}/ocr | Full document, subject, type, and sender detection', flush=True)
    print(f'[HEALTH CHECK] http://{host}:{port}/health', flush=True)
    if shutil.which(TESSERACT_CMD) or Path(TESSERACT_CMD).is_file():
        print('[TESSERACT]', TESSERACT_CMD, flush=True)
    else:
        print('[TESSERACT] Not found. Install Tesseract-OCR to read scans and images; native document text remains available.', flush=True)
    print('[SERVER] Keep this window open while using OCR. Press Ctrl+C to stop.', flush=True)
    app.run(host=host, port=port, debug=False, threaded=True)
if __name__ == '__main__':
    main()
