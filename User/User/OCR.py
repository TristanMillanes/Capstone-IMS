"""
PGENRO Intelligent Full-Document OCR & Letter Classifier Engine
Run: python OCR.py
Required packages: pip install Flask flask-cors PyMuPDF Pillow
Requires Tesseract-OCR installed on the system (eng + fil/tgl recommended).
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
import posixpath
import math
import uuid
from collections import OrderedDict
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET

if __name__ == '__main__':
    print('[STARTUP] Initializing PGENRO Generalized OCR & Letter Classifier Server...', flush=True)

try:
    import pymupdf as fitz
    from PIL import Image, ImageEnhance, ImageOps, ImageSequence, ImageChops, ImageStat, ImageFilter, UnidentifiedImageError
except ImportError:
    print('[STARTUP ERROR] Dependencies missing. Run: pip install Flask flask-cors PyMuPDF Pillow', file=sys.stderr)
    raise

MAX_BYTES = 50 * 1024 * 1024
ALLOWED_EXTENSIONS = {'pdf', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff', 'docx', 'txt', 'csv', 'xlsx', 'pptx'}
OCR_LANG_REQUESTED = os.getenv('OCR_LANG', 'eng+fil').strip() or 'eng'
OCR_PARSER_VERSION = 20
OCR_TIMEOUT = max(5, int(os.getenv('OCR_TIMEOUT', '45')))
OCR_DOCUMENT_TIMEOUT = max(OCR_TIMEOUT, int(os.getenv('OCR_DOCUMENT_TIMEOUT', '140')))
OCR_WORKERS = max(1, min(4, int(os.getenv('OCR_WORKERS', str(min(2, os.cpu_count() or 1))))))
OCR_DPI = max(150, min(400, int(os.getenv('OCR_DPI', '260'))))
OCR_MAX_SIDE = max(1600, min(5000, int(os.getenv('OCR_MAX_SIDE', '3200'))))
OCR_MIN_CONFIDENCE = float(os.getenv('OCR_MIN_CONFIDENCE', '60'))
OCR_CACHE_SIZE = max(0, int(os.getenv('OCR_CACHE_SIZE', '25')))
OCR_CACHE_TTL = max(0, int(os.getenv('OCR_CACHE_TTL', '600')))
OCR_PAGE_CACHE_SIZE = max(0, int(os.getenv('OCR_PAGE_CACHE_SIZE', '64')))
OCR_DOCUMENT_WORKERS = max(1, min(4, int(os.getenv('OCR_DOCUMENT_WORKERS', '1'))))
OCR_MAX_ACTIVE = max(OCR_DOCUMENT_WORKERS, min(16, int(os.getenv('OCR_MAX_ACTIVE', '4'))))

_pool = ThreadPoolExecutor(max_workers=OCR_WORKERS, thread_name_prefix='pgenro-gen-ocr')
_ocr_slots = threading.BoundedSemaphore(OCR_WORKERS)
_document_slots = threading.BoundedSemaphore(OCR_DOCUMENT_WORKERS)
_pdf_lock = threading.RLock()
_state = contextvars.ContextVar('ocr_state', default=None)
_cache = OrderedDict()
_cache_lock = threading.Lock()
_cache_bytes = 0
_CACHE_MAX_BYTES = 8 * 1024 * 1024
_active_reads = {}
_client_reads = {}
_cancelled_reads = OrderedDict()
_reads_lock = threading.Lock()
_recent_reads = OrderedDict()
_page_cache = OrderedDict()
_page_cache_lock = threading.Lock()

class ReadCancelled(RuntimeError): pass
class DocumentTimeout(RuntimeError): pass

class ReadState:
    def __init__(self):
        self.started = time.monotonic()
        self.deadline = self.started + OCR_DOCUMENT_TIMEOUT
        self.passes = 0
        self.confidences = []
        self.warnings = []
        self.review_fields = set()
        self.lock = threading.Lock()
        self.cancelled = threading.Event()
        self.total_pages = 0
        self.completed_pages = 0
        self.completed_indices = set()
        self.cached_pages = 0
        self.stage = 'Preparing document'

    def snapshot(self):
        with self.lock:
            return {
                'pages': self.total_pages,
                'completedPages': self.completed_pages,
                'cachedPages': self.cached_pages,
                'stage': self.stage,
                'durationMs': round((time.monotonic() - self.started) * 1000),
                'ocrPasses': self.passes,
                'cancelled': self.cancelled.is_set()
            }

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

def reading_progress(total=None, completed=None, stage=None):
    current = _state.get()
    if current:
        with current.lock:
            if total is not None: current.total_pages = total
            if completed is not None: current.completed_pages = completed
            if stage is not None: current.stage = stage

@contextmanager
def pdf_access():
    while not _pdf_lock.acquire(timeout=min(.2, check_budget())):
        check_budget()
    try:
        yield
    finally:
        _pdf_lock.release()

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
    if not OCR_CACHE_SIZE or not OCR_CACHE_TTL: return
    size = len(json.dumps(result, ensure_ascii=False).encode('utf-8'))
    if size > _CACHE_MAX_BYTES: return
    with _cache_lock:
        old = _cache.pop(key, None)
        if old: _cache_bytes -= old[2]
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


def resolve_ocr_language(requested):
    """Use requested OCR languages that are actually installed, with English as a safe fallback."""
    requested_codes = [code.strip() for code in re.split(r'[+,]', str(requested or 'eng')) if code.strip()]
    if not requested_codes:
        requested_codes = ['eng']
    try:
        result = subprocess.run(
            [TESSERACT_CMD, '--list-langs'],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=5,
            check=False,
        )
        if result.returncode == 0:
            available = {
                line.strip() for line in result.stdout.splitlines()
                if line.strip() and not line.lower().startswith('list of available languages')
            }
            selected = [code for code in requested_codes if code in available]
            if not selected and 'eng' in available:
                selected = ['eng']
            if selected:
                missing = [code for code in requested_codes if code not in available]
                if missing:
                    print(
                        '[OCR] Language data not installed for ' + ', '.join(missing)
                        + '; using ' + '+'.join(selected) + '.',
                        file=sys.stderr,
                        flush=True,
                    )
                return '+'.join(selected)
    except (OSError, subprocess.SubprocessError):
        pass
    # Leave the configured value intact when the executable cannot be queried.
    # The request handler will report a useful Tesseract error if it is missing.
    return '+'.join(requested_codes)


OCR_LANG = resolve_ocr_language(OCR_LANG_REQUESTED)

# =========================================================================
# GENERAL LETTER & ADMINISTRATIVE FUZZY PATTERNS
# =========================================================================

CLOSING = re.compile(
    r'^(?:(?:VERY\s+)?(?:YOURS\s+)?(?:SINCERELY|RESPECTFULLY|FAITHFULLY|TRULY)(?:\s+(?:YOURS|SUBMITTED))?|'
    r'YOURS\s+(?:TRULY|FAITHFULLY|SINCERELY|RESPECTFULLY)|BEST\s+REGARDS|KIND\s+REGARDS|WARM\s+REGARDS|REGARDS|CORDIALLY|'
    r'LUBOS\s+NA\s+GUMAGALANG|SUMASAINYO|SUMASAINYO\s+PANGALAN|MARAMING\s+SALAMAT|THANK\s+YOU(?:\s+VERY\s+MUCH)?|'
    r'FOR\s+YOUR\s+(?:COMPLIANCE|INFORMATION(?:\s+AND\s+(?:APPROPRIATE\s+ACTION|COMPLIANCE|GUIDANCE))?|GUIDANCE))\s*[,.:!]?$',
    re.I
)

ROLE = re.compile(
    r'\b(?:PGDH|PGENRO|ENRO|OIC|OFFICER|DIRECTOR|CHIEF|MAYOR|GOVERNOR|ADMINISTRATOR|SUPERVISOR|MANAGER|'
    r'SECRETARY|SECRETARIAT|CONVENER|CONVENOR|FOCAL\s+PERSON|HEAD|PRESIDENT|CHAIRPERSON|CHAIRMAN|COORDINATOR|'
    r'PRINCIPAL|TEACHER|ENGINEER|TREASURER|REPRESENTATIVE|PROPRIETOR|OWNER|STUDENT|APPLICANT|DEAN|PROFESSOR|'
    r'SPECIALIST|STAFF|ASSISTANT|COUNCILOR|REGISTRAR|LIBRARIAN|CONSULTANT|AIDE|CLERK|ACCOUNTANT|AUDITOR|'
    r'ANALYST|SUPERINTENDENT|RECTOR|PASTOR|LAWYER|PANGULO|KALIHIM|TAGAPANGULO|KAGAWAD|KAPITAN|PUNONG\s+BARANGAY|'
    r'EXECUTIVE\s+ASSISTANT|ADMINISTRATIVE\s+OFFICER|ATTORNEY|ATTY|ENGR|DIR)\b|'
    r'(?-i:^[A-Z0-9]{2,}[#?]?(?:[-/][A-Z0-9]{2,})+$)',
    re.I
)

SIGN_LABEL = re.compile(
    r'^(?:SIGNED(?:\s+BY)?|SIGNATORY|WRITTEN\s+BY|AUTHORED\s+BY|ISSUED\s+BY|NOTICE\s+FROM|CONVENED\s+BY|'
    r'SUBMITTED\s+BY|PREPARED\s+BY|APPROVED\s+BY|NOTED\s+BY|CERTIFIED\s+BY|RECOMMENDING\s+APPROVAL|'
    r'RESPECTFULLY\s+SUBMITTED\s+BY|NAME\s+OF\s+(?:SENDER|SIGNATORY)|NILAGDAAN\s+NI|INIHANDA\s+NI|INAPRUBAHAN\s+NI|'
    r'PINAGTIBAY\s+NI|PANGALAN\s+AT\s+LAGDA)\s*[:：-]?\s*(.*)$',
    re.I
)

FIELD_LABEL = re.compile(
    r'^(?:S[Uu0]BJ[Ee3]CT(?:\s+MATTER)?|S[Uu0]BJ[Ee3]C[TIL1]|S[Uu0]BJ|R[Ee]|'
    r'D[Aa@]T[Ee](?:\s+(?:[I1]SSU[Ee]D|R[Ee]C[Ee][I1]V[Ee]D|R[Ee]L[Ee][Aa]S[Ee]D))?|D[Aa@]T[Ee]D|P[Ee]TS[Aa]|'
    r'T[O0]|F[O0]R|P[Aa]R[Aa](?:\s+(?:K[Aa]Y|S[Aa]))?|FR[O0]M|S[Ee]ND[Ee]R|MUL[Aa](?:\s+(?:K[Aa]Y|S[Aa]))?|'
    r'THR[O0]UGH|THRU|CC|ATTACHM[Ee]NTS?|ENCL[O0]SUR[Ee]S?|R[Ee]F(?:[Ee]R[Ee]NC[Ee])?|'
    r'C[O0]NTR[O0]L(?:\s+(?:N[O0]\.?|N[Uu]MB[Ee]R))?|[I1]SSU[Ee]D\s+BY|S[I1]GN[Aa]T[O0]RY|R[Ee]M[Aa]RKS)\s*[:：;\-]',
    re.I
)

BODY = re.compile(
    r'^(?:DEAR|GREETINGS|GOOD\s+(?:DAY|MORNING|AFTERNOON)|SIR|MADAM|MA\x27AM|TO\s+WHOM|PLEASE|KINDLY|'
    r'THIS\s+(?:IS|HAS|WILL|REFERS|SERVES|LETTER)|WE\s+(?:ARE|WILL|WOULD|REQUEST|HEREBY)|I\s+(?:AM|WOULD|WRITE|HEREBY)|'
    r'YOU\s+ARE|THE\s+UNDERSIGNED|IN\s+(?:LIGHT\s+OF|CONNECTION\s+WITH|ACCORDANCE\s+WITH|VIEW\s+OF)|'
    r'PURSUANT\s+TO|FOR\s+YOUR\s+(?:INFORMATION|COMPLIANCE|GUIDANCE)|SINCERELY|RESPECTFULLY|'
    r'MAGANDANG\s+(?:ARAW|UMAGA|HAPON)|MAHAL\s+NA|MANGYARING|PAKIUSAP|KAMI\s+(?:AY|PO)|AKO\s+(?:AY|PO)|'
    r'KAUGNAY|LUBOS\s+NA\s+GUMAGALANG|IPINAPABATID|NAIS\s+(?:KO|NAMING))\b',
    re.I
)

SENDER_TITLES = r'Mr|Mrs|Ms|Miss|Dr|Dra|Atty|Attorney|Engr|Engineer|EnP|Hon|Prof|Professor|Rev|Fr|Bro|Sis|Gov|Governor|Mayor|Dir|Director|Capt|Col|Gen|Lt|Major'
SENDER_CREDENTIALS = r'Ph\.?D\.?|Ed\.?D\.?|DPA|DMD|M\.?D\.?|MBA|MPA|MAEd|MSc|MA|MS|CPA|RN|LPT|RGC|RMT|RPh|RCE|RME|REE|CESO(?:\s+[IVX]+)?|EnP|LLB|JD'

def tidy(value):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFC', str(value or ''))).strip()

def clean_text(text):
    text = str(text or '').replace('\r\n', '\n').replace('\r', '\n').replace('\u00a0', ' ')
    return '\n\f\n'.join('\n'.join(re.sub(r'[ \t]{2,}', '  ', line).strip() for line in page.split('\n')).strip() for page in text.split('\f')).strip(' \t\r\n')

def split_signature_name_role(value):
    value = tidy(value)
    labelled_role = re.match(r'^([^:：]{2,65})\s*[:：]\s*(.+)$', value)
    if labelled_role and ROLE.search(labelled_role[1]):
        return labelled_role[2].strip(), labelled_role[1].strip()
    parenthetical = re.search(r'\s*\(([^()]*)\)\s*$', value)
    if parenthetical and ROLE.search(parenthetical[1]):
        return value[:parenthetical.start()].strip(), parenthetical[1].strip()
    separators = list(re.finditer(r'\s*[|,]\s*|\s+[-\u2013\u2014]\s+', value))
    for i, separator in enumerate(separators):
        end = separators[i + 1].start() if i + 1 < len(separators) else len(value)
        if ROLE.search(value[separator.end():end]):
            return value[:separator.start()].strip(), value[separator.end():].strip()
    trailing_role = re.search(r'\s+(?:(?:Acting|Assistant|Deputy|Municipal|Provincial|City|Regional|District|Division|Department|Administrative|School|General|Executive|Senior|Junior)\s+)*(?:PGDH(?:[-/][A-Z]+)?|PGENRO|ENRO|OIC|Officer|Director|Chief|Manager|Mayor|Governor|President|Secretary|Chairperson|Chairman|Coordinator|Principal|Superintendent|Engineer|Treasurer|Administrator|Clerk|Aide|Registrar|Librarian|Head)\b', value, re.I)
    if trailing_role and len(value[:trailing_role.start()].split()) >= 2:
        return value[:trailing_role.start()].strip(), value[trailing_role.start():].strip()
    return value, ''

# =========================================================================
# IMAGE PREPROCESSING & AUTO-DESKEWING
# =========================================================================

def deskew_image(image):
    """Corrects minor slant/tilt in scanned or photographed letters."""
    try:
        small = image.resize((image.width // 2, image.height // 2), Image.Resampling.NEAREST).convert('L')
        bw = small.point(lambda x: 0 if x < 128 else 255, '1')
        best_angle = 0
        max_variance = 0
        for angle in range(-8, 9, 2):
            rotated = bw.rotate(angle, expand=False, fillcolor=255)
            hist = [0] * rotated.height
            pix = rotated.load()
            for y in range(0, rotated.height, 4):
                hist[y] = sum(1 for x in range(0, rotated.width, 4) if pix[x, y] == 0)
            variance = statistics.variance(hist) if len(hist) > 1 else 0
            if variance > max_variance:
                max_variance = variance
                best_angle = angle
        if abs(best_angle) >= 2:
            return image.rotate(best_angle, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=(255, 255, 255))
    except Exception:
        pass
    return image

def opaque_image(image):
    image = ImageOps.exif_transpose(image)
    if image.mode in ('RGBA', 'LA') or 'transparency' in image.info:
        rgba = image.convert('RGBA')
        background = Image.new('RGB', image.size, 'white')
        background.paste(rgba, mask=rgba.getchannel('A'))
        return background
    return image.convert('RGB')

def resize_ocr_image(image):
    if image.width < 1600:
        scale = min(3, 1600 / max(1, image.width), OCR_MAX_SIDE / max(image.size))
    else:
        scale = min(1, OCR_MAX_SIDE / max(image.size))
    if abs(scale - 1) > .01:
        image = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)
    return image

def preprocess_image_for_ocr(image, resize=True):
    image = opaque_image(image)
    if resize:
        image = resize_ocr_image(image)
    image = deskew_image(image)
    gray = ImageOps.grayscale(image)
    if ImageStat.Stat(gray.resize((64, 64))).mean[0] < 110:
        gray = ImageOps.invert(gray)
    sharpened = gray.filter(ImageFilter.UnsharpMask(radius=1.5, percent=125, threshold=3))
    return ImageEnhance.Contrast(ImageOps.autocontrast(sharpened, cutoff=0.5)).enhance(1.35)

def trim_blank_margins(image):
    gray = ImageOps.grayscale(image)
    if ImageStat.Stat(gray.resize((64, 64))).mean[0] < 110:
        return image
    box = gray.point(lambda value: 255 if value < 245 else 0).getbbox()
    if box is None:
        return image
    left, top, right, bottom = box
    pad = max(24, round(min(image.size) * .02))
    box = (max(0, left - pad), max(0, top - pad), min(image.width, right + pad), min(image.height, bottom + pad))
    return image.crop(box) if box[2] - box[0] >= 350 and box[3] - box[1] >= 100 else image

def run_tesseract(image, psm=3, with_data=False, whitelist=''):
    while not _ocr_slots.acquire(timeout=min(.2, check_budget())):
        check_budget()
    try:
        timeout = min(OCR_TIMEOUT, check_budget())
        with tempfile.TemporaryDirectory(prefix='pgenro_ocr_') as folder:
            path, output = Path(folder) / 'page.pgm', Path(folder) / 'result'
            image.convert('L').save(path, 'PPM')
            command = [TESSERACT_CMD, str(path), str(output), '-l', OCR_LANG,
                       '--oem', '3', '--psm', str(psm), '--dpi', str(OCR_DPI),
                       '-c', 'preserve_interword_spaces=1']
            if whitelist:
                command += ['-c', 'tessedit_char_whitelist=' + whitelist]
            command += ['txt', 'tsv']
            env = os.environ.copy()
            env.setdefault('OMP_THREAD_LIMIT', '1')
            current = _state.get()
            if current:
                with current.lock: current.passes += 1
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
            deadline = time.monotonic() + timeout
            try:
                while True:
                    check_budget()
                    left = deadline - time.monotonic()
                    if left <= 0: raise subprocess.TimeoutExpired(command, timeout)
                    try:
                        _, stderr = process.communicate(timeout=min(.2, left))
                        break
                    except subprocess.TimeoutExpired:
                        continue
            finally:
                if process.poll() is None: process.kill()
                process.communicate()
            if process.returncode:
                raise RuntimeError(stderr.decode('utf-8', errors='replace').strip() or 'Tesseract read failure. Check OCR_LANG and installed language data.')
            text = clean_text(output.with_suffix('.txt').read_text(encoding='utf-8', errors='replace').rstrip('\f \t\r\n'))
            rows = []
            for row in csv.DictReader(io.StringIO(output.with_suffix('.tsv').read_text(encoding='utf-8', errors='replace')), delimiter='\t'):
                try: confidence = float(row.get('conf', -1))
                except (ValueError, TypeError): continue
                if confidence >= 0 and str(row.get('text', '')).strip():
                    rows.append({**row, 'conf': confidence})
            weights = [max(1, len(row['text'])) for row in rows]
            confidence = sum(row['conf'] * weight for row, weight in zip(rows, weights)) / max(1, sum(weights))
            data = {'text': text, 'confidence': round(confidence, 2), 'words': rows}
            return data if with_data else text
    finally:
        _ocr_slots.release()

# =========================================================================
# SENDER / SIGNATORY DETECTOR
# =========================================================================

SENDER_FIELDS = (
    r'RECEIVED\s+FROM|FROM|SENDER|MULA(?:\s+(?:KAY|SA))?|SENT\s+BY|ORIGINATOR|'
    r'ORIGINATED\s+BY|AUTHOR|AUTHORED\s+BY|WRITTEN\s+BY|ISSUED\s+BY|NOTICE\s+FROM|CONVENED\s+BY|'
    r'TRANSMITTED\s+BY|ENDORSED\s+BY|REQUESTED\s+BY'
)
SENDER_FIELD = re.compile(r'^(?:' + SENDER_FIELDS + r')(?:\s*[:：;–—-]\s*|[ \t]+)(.*)$', re.I)
SENDER_BARE = re.compile(r'^(?:' + SENDER_FIELDS + r')\s*[:：;]?$', re.I)
SENDER_MARK = re.compile(
    r'^(?:\(\s*(?:s\.?g\.?d\.?|signed|signature)\s*\)|s\.?g\.?d\.?|/s/|e[- ]?signed(?:\s+by)?|'
    r'digitally\s+signed\s+by|signed\s+(?:by|electronically\s+by)|signature\s+(?:over\s+printed\s+name|of)|'
    r'printed\s+name|pangalan\s+at\s+lagda|nilagdaan\s+ni)\s*[:：,–—-]?\s*(.*)$',
    re.I
)
SENDER_CONTACT = re.compile(r'^(?:TEL(?:EPHONE)?|PHONE|CONTACT|MOBILE|FAX|WWW\.|E-?MAIL|PAGE\b|REV\.?\s+NO|DOCUMENT\s+CODE)|@|https?://', re.I)
SENDER_NON_NAME = re.compile('\\b(?:national|environment|natural|resources|college|school|university|institute|institution|foundation|corporation|company|association|cooperative|agency|committee|secretariat|team|unit|bureau|commission|authority|republic|province|provincial|municipal|regional|district|government|office|department|division|subject|memorandum|notice|meeting|report|document|reference|control|end|signature|remarks|status|dear|thank|please|request|hereby|attached|enclosed|address|telephone|email|contact|mobile|fax|street|road|avenue|barangay|brgy|city|municipality|center|centre|metro|disaster|risk|management|operations|services|council|members|participants|personnel|regards|copy|cc|page|for|to|from|education|health|planning|workshop|agenda|attendance|schedule|venue|date|time|location|activity|program|event|safety|training|session|annual|quarterly|project|inc|ltd|everyone|see|you|all|welcome|regards|regarding|compliance|information|attention)\\b', re.I)

def sender_name_key(value):
    value = re.sub(r'^(?:(?:' + SENDER_TITLES + r')\.?\s+)+', '', value, flags=re.I)
    value = re.sub(r',?\s+(?:' + SENDER_CREDENTIALS + r')(?:[,\s].*)?$', '', value, flags=re.I)
    return re.sub(r'[^\w]', '', unicodedata.normalize('NFC', value).casefold())

def sender_ink_spacing(value):
    return re.sub(r'(?<=[^\W\d_])\s*[?*|_~]+\s*(?=[A-Z]\.\s*[^\W\d_])', ' ', value)

def name_value(value, contextual=False):
    value = tidy(value)
    mark = SENDER_MARK.match(value)
    if mark: value = mark[1]
    value = re.sub(r'^by\s*:\s*', '', value, flags=re.I).strip('|:_- "“”')
    value, _ = split_signature_name_role(value)
    ink_cleanup = contextual and sender_ink_spacing(value) != value
    if contextual: value = sender_ink_spacing(value)
    value = re.sub(r'^(' + SENDER_TITLES + r')\.(?=[^\W\d_])', r'\1. ', value, flags=re.I)
    validation = value
    if not 4 <= len(value) <= 120 or re.search(r'[\d@:/;!?()]', validation) or BODY.match(validation) or CLOSING.match(validation):
        return ''
    base = re.sub(r'^(?:(?:' + SENDER_TITLES + r')\.?\s+)+', '', validation, flags=re.I)
    base = re.sub(r',?\s+(?:' + SENDER_CREDENTIALS + r')(?:[,\s].*)?$', '', base, flags=re.I)
    if SENDER_NON_NAME.search(base) or ROLE.search(base):
        return ''
    words = base.replace(',', ' ').split()
    if not 2 <= len(words) <= 9: return ''
    particles = {'de', 'del', 'dela', 'la', 'las', 'los', 'da', 'dos', 'di', 'du', 'van', 'von', 'bin', 'al', 'y', 'san', 'santa'}
    suffixes = {'jr', 'sr', 'ii', 'iii', 'iv', 'v'}
    # Reject lowercase scan debris mixed with capitalized names; never guess its letters.
    if (not contextual or ink_cleanup or not base.islower()) and any(not (w.casefold().strip('.') in particles | suffixes or w[0].isupper()) for w in words):
        return ''
    lengths = [sum(c.isalpha() for c in w) for w in words]
    substantive = [i for i, w in enumerate(words) if w.casefold().strip('.') not in particles | suffixes]
    initials = substantive and lengths[substantive[-1]] > 1 and all(lengths[i] == 1 for i in substantive[:-1])
    if len(substantive) < 2 or (sum(lengths[i] > 1 for i in substantive) < 2 and not initials):
        return ''
    if any(not all(c.isalpha() or c in ".'’-" for c in w) for w in words):
        return ''
    return re.sub(r'(?<=\s)([A-Z])(?=\s)', r'\1.', re.sub(r'\.{2,}', '.', value))

def sender_entries(text):
    # Keep page/line evidence and normalize same-line closings and header columns.
    text = re.sub(r'^((?:(?:very\s+)?(?:yours\s+)?(?:sincerely|respectfully|faithfully|truly)(?:\s+(?:yours|submitted))?|yours\s+(?:truly|faithfully|sincerely|respectfully)|best\s+regards|kind\s+regards|lubos\s+na\s+gumagalang))[,.:][ \t]+(?=[^\W\d_])', r'\1,\n', str(text or ''), flags=re.I|re.M)
    entries = []
    excluded = False
    for p, page in enumerate(primary_document_pages(text), 1):
        for line_number, raw in enumerate(page.split('\n'), 1):
            raw = re.sub(r'[ \t]{2,}(?=(?:' + HEADER_LABELS + '|' + SENDER_FIELDS + r')\s*[:：;])', '\n', raw, flags=re.I)
            for cell in raw.split('\n'):
                if re.match(r'^\s*(?:CC\s*:|COPY\s+(?:TO|FURNISHED)|ANNEX\b|APPENDIX\b|ATTACHMENTS?\s*:|ENCLOSURES?\s*:)', cell, re.I):
                    excluded = True
                if tidy(cell):
                    entries.append({'text': tidy(cell), 'raw': cell.strip(), 'page': p, 'line': line_number, 'excluded': excluded})
    return entries


def sender_body_line(value):
    if CLOSING.match(value) or HEADER_FIELD.match(value) or HEADER_BARE.match(value) or SIGN_LABEL.match(value) or SENDER_MARK.match(value):
        return False
    if BODY.match(value): return True
    words = value.split()
    return bool(((len(words) >= 6 and re.search(r'[.!?]$', value)) or len(words) >= 10) and any(c.islower() for c in value) and not ROLE.search(value))


def scan_sender_candidates(text, signature_region=False):
    """Rank printed people by authorship evidence; never use a letterhead as a person."""
    entries, candidates, consumed = sender_entries(text), [], set()
    first_body = next((i for i, e in enumerate(entries) if sender_body_line(e['text'])), -1)
    greeting = next((i for i, e in enumerate(entries) if re.match(r'^DEAR\b|^(?:SIR|MADAM|MA.AM)\s*[:,]', e['text'], re.I)), -1)
    compact = 0 < len(entries) <= 6 and not any(HEADER_FIELD.match(e['text']) or HEADER_BARE.match(e['text']) or BODY.match(e['text']) or parse_date(e['text']) for e in entries)

    def role_at(index, step, page):
        parts = []
        for j in range(index, index + step * 3, step):
            if not 0 <= j < len(entries): break
            e, value = entries[j], entries[j]['text']
            if e['page'] != page or e['excluded'] or HEADER_FIELD.match(value) or HEADER_BARE.match(value) or SIGN_LABEL.match(value) or SENDER_MARK.match(value) or BODY.match(value) or CLOSING.match(value) or name_value(value) or SENDER_CONTACT.search(value): break
            if len(value) > 120 or len(value.split()) > 18 or re.search(r'\d{3}', value) or (len(value.split()) > 7 and re.search(r'[.!?]$', value)): break
            if step > 0: parts.append(value)
            else: parts.insert(0, value)
            if ROLE.search(' '.join(parts)): return ' '.join(parts)
        return ''

    def add(name, role, entry, score, kind, proof, ink=False):
        candidate = dict(name=name, role=role, page=entry['page'], line=entry['line'], score=score, kind=kind, evidence=proof, inkCleanup=ink, confidence='low' if ink else 'high' if score >= 100 else 'medium')
        prior = next((c for c in candidates if sender_name_key(c['name']) == sender_name_key(name)), None)
        if prior is None: candidates.append(candidate)
        elif score > prior['score']: prior.update(candidate)

    for i, entry in enumerate(entries):
        if entry['excluded'] or i in consumed: continue
        value = entry['text']
        field, bare = SENDER_FIELD.match(entry['raw']), SENDER_BARE.fullmatch(value)
        label, mark = SIGN_LABEL.match(value), SENDER_MARK.match(value)
        explicit = bool((field or bare) and (first_body < 0 or i < first_body or re.match(r'^(?:AUTHOR|AUTHORED|WRITTEN|ISSUED|NOTICE|CONVENED)\b', value, re.I)))
        anchor = None
        for j in range(i-1, max(-1, i-7), -1):
            prev = entries[j]
            if prev['page'] != entry['page'] or prev['excluded']: break
            if CLOSING.match(prev['text']) or SIGN_LABEL.match(prev['text']) or SENDER_MARK.match(prev['text']):
                anchor = prev; break
            if name_value(prev['text']) or HEADER_FIELD.match(prev['text']) or BODY.match(prev['text']) or len(prev['text'].split()) > 18: break
        context = bool(explicit or label or mark or anchor)
        raw = (field[1] if field else '') if explicit else label[1] if label else mark[1] if mark else entry['raw']
        index = i
        if (explicit or label or mark) and not raw:
            index = i+1
            if index >= len(entries) or entries[index]['page'] != entry['page'] or entries[index]['excluded'] or HEADER_FIELD.match(entries[index]['text']) or SIGN_LABEL.match(entries[index]['text']): continue
            raw = entries[index]['raw']
        if explicit and not name_value(raw, True):
            for probe in range(index+1, min(len(entries), index+5)):
                e = entries[probe]
                if e['page'] != entry['page'] or e['excluded'] or HEADER_FIELD.match(e['text']) or HEADER_BARE.match(e['text']) or BODY.match(e['text']) or CLOSING.match(e['text']) or SIGN_LABEL.match(e['text']): break
                if name_value(e['text'], True): index, raw = probe, e['raw']; break
        columns = re.split(r'[ \t]{2,}|\s+\|\s+', raw)
        column_names = [name_value(col, context or signature_region or (first_body >= 0 and index > first_body)) for col in columns]
        if len(columns) > 1 and all(column_names) and (context or signature_region or (first_body >= 0 and index > first_body)):
            for name, col in zip(column_names, columns): add(name, '', entries[index], 130 if explicit else 110 if anchor else 78, 'explicit-sender' if explicit else 'footer-name', value, sender_ink_spacing(col) != col)
            if index != i: consumed.add(index)
            continue
        inline_name, inline_role = split_signature_name_role(raw)
        nearby_role = inline_role or role_at(index+1, 1, entry['page']) or role_at(index-1, -1, entry['page'])
        name, next_index = name_value(raw, context or bool(nearby_role) or signature_region), index+1
        if next_index < len(entries) and entries[next_index]['page'] == entry['page'] and not entries[next_index]['excluded']:
            surname = entries[next_index]['text']
            short = len(surname.split()) == 1 or re.fullmatch(r'(?:DE|DEL|DELA|VAN|VON)\s+\S+', surname, re.I)
            if short and not ROLE.search(surname) and not HEADER_FIELD.match(surname) and not SIGN_LABEL.match(surname) and len(inline_name.split()) <= 3 and role_at(next_index+1, 1, entry['page']):
                joined = name_value(inline_name + ' ' + surname, context)
                if joined: name = joined; next_index += 1; consumed.add(index+1)
        if not name: continue
        role = inline_role or role_at(next_index, 1, entry['page']) or role_at(index-1, -1, entry['page'])
        if not context:
            if (greeting >= 0 and index < greeting) or (first_body >= 0 and index < first_body): continue
            later_header = any(not e['excluded'] and e['page'] == entry['page'] and (HEADER_FIELD.match(e['text']) or HEADER_BARE.match(e['text']) or MEMO_HEADING.match(e['text']) or re.match(r'^NOTICE\s+OF\s+MEETING\b', e['text'], re.I) or parse_date(e['text'])) for e in entries[next_index:next_index+8])
            if first_body < 0 and later_header: continue
            field_index = next((j for j in range(index-1, -1, -1) if entries[j]['page'] == entry['page'] and (HEADER_FIELD.match(entries[j]['text']) or HEADER_BARE.match(entries[j]['text']))), -1)
            if field_index >= 0 and re.match(r'^(?:TO|T0|FOR|PARA|RECIPIENT|ADDRESSED|SUBJECT|SUBJ|PAKSA|THRU|THROUGH|ATTN|ATTENTION)\b', entries[field_index]['text'], re.I) and index-field_index <= 8:
                separating_body = any(BODY.match(e['text']) or len(e['text'].split()) > 6 or (re.search(r'[.!?]$', e['text']) and not name_value(e['text'])) for e in entries[field_index+1:index])
                if not separating_body and entry['line']-entries[field_index]['line'] <= index-field_index: continue
        meaningful_after = [e for e in entries[next_index:] if not e['excluded'] and not SENDER_CONTACT.search(e['text']) and not re.fullmatch(r'[-_=\s]+', e['text'])]
        content_before = (first_body >= 0 and index > first_body) or any(HEADER_FIELD.match(e['text']) or HEADER_BARE.match(e['text']) for e in entries[:index])
        if explicit: score, kind = 130, 'explicit-sender'
        elif label or (mark and mark[1]) or (anchor and SENDER_MARK.match(anchor['text'])): score, kind = 120, 'signature'
        elif anchor: score, kind = 110, 'signature'
        elif role and (content_before or signature_region or compact): score, kind = 90, 'signature'
        elif (not meaningful_after or all(name_value(e['text']) for e in meaningful_after)) and (content_before or signature_region or compact) and not role: score, kind = 78, 'footer-name'
        else: continue
        marker = value if label else anchor['text'] if anchor else ''
        if re.match(r'^(?:prepared|submitted|respectfully\s+submitted|inihanda)\b', marker, re.I): score, kind = 85, 'prepared-by'
        elif re.match(r'^(?:noted|certified|recommending)\b', marker, re.I): score, kind = 55, 'supporting'
        elif re.match(r'^(?:approved|inaprubahan)\b', marker, re.I): score, kind = 65, 'approval'
        ink = sender_ink_spacing(inline_name) != inline_name
        proof = '\n'.join(dict.fromkeys(v for v in [value if explicit or label or mark else anchor['text'] if anchor else '', inline_name if ink else name, role] if v))
        add(name, role, entries[index], score, kind, proof, ink)
        if index != i: consumed.add(index)
    candidates.sort(key=lambda c: (-c['score'], c['page'], c['line']))
    eligible = [c for c in candidates if c['kind'] != 'supporting']
    primary = [c for c in eligible if eligible[0]['score'] - c['score'] < 10]
    return dict(entries=entries, candidates=candidates, primary=primary, selected=primary[0] if len(primary) == 1 else None)


def parse_correspondence(text, signature_region=False):
    header, scan = parse_header(text), scan_sender_candidates(text, signature_region)
    selected = scan['selected']
    received = selected['name'] if selected else ''
    source = selected['kind'] if selected else 'ambiguous' if scan['primary'] else 'missing'
    reasons = []
    review = not received or bool(selected and (selected['inkCleanup'] or source in ('footer-name', 'prepared-by', 'approval') or selected['score'] < 90))
    if selected and selected['inkCleanup']: reasons.append('Signature ink affected the printed name. Confirm it against the document.')
    if source == 'explicit-sender' and any(c['kind'] == 'signature' and sender_name_key(c['name']) != sender_name_key(received) for c in scan['candidates']):
        review = True; reasons.append('The sender field and printed signatory differ. Confirm the originating person.')
    if source == 'ambiguous': reasons.append('Several possible senders were found. Choose the originating person.')
    elif not received: reasons.append('No readable sender name was identified. A signature alone cannot establish a person\'s name.')
    elif source == 'footer-name': reasons.append('An unlabeled printed name was found. Confirm the originating person.')
    elif source in ('prepared-by', 'approval'): reasons.append('A preparer or approver was found. Confirm the originating person.')
    return dict(signatory=received, signatoryRole=selected['role'] if selected else '', signatoryCandidates=scan['candidates'], receivedFrom=received, receivedFromSource=source, receivedFromNeedsReview=review, senderConfidence=selected['confidence'] if selected else 'unknown', senderReviewReasons=reasons, sender=header['senderOffice'], recipient=header['recipient'], fieldEvidence={'receivedFrom': selected['evidence'] if selected else ''}, needsReview=['receivedFrom'] if review else [])


def extract_signatory_text(text):
    return parse_correspondence(text)['signatory']

# =========================================================================
# DATE & HEADER PARSERS
# =========================================================================

def parse_date(value):
    months = {
        'january': 1, 'jan': 1, 'enero': 1, 'ene': 1,
        'february': 2, 'feb': 2, 'pebrero': 2, 'peb': 2,
        'march': 3, 'mar': 3, 'marso': 3,
        'april': 4, 'apr': 4, 'abril': 4, 'abr': 4,
        'may': 5, 'mayo': 5,
        'june': 6, 'jun': 6, 'hunyo': 6, 'hun': 6,
        'july': 7, 'jul': 7, 'hulyo': 7, 'hul': 7,
        'august': 8, 'aug': 8, 'agosto': 8, 'ago': 8,
        'september': 9, 'sep': 9, 'sept': 9, 'setyembre': 9, 'set': 9,
        'october': 10, 'oct': 10, 'oktubre': 10, 'okt': 10,
        'november': 11, 'nov': 11, 'nobyembre': 11, 'nob': 11,
        'december': 12, 'dec': 12, 'disyembre': 12, 'dis': 12
    }
    text = str(value or '').strip()
    m = re.search(r'\b([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b', text, re.I)
    if m and m.group(1).lower() in months:
        try: return datetime(int(m[3]), months[m[1].lower()], int(m[2])).date().isoformat()
        except ValueError: return ''
    m = re.search(r'\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?,?\s+(\d{4})\b', text, re.I)
    if m and m.group(2).lower() in months:
        try: return datetime(int(m[3]), months[m[2].lower()], int(m[1])).date().isoformat()
        except ValueError: return ''
    m = re.search(r'\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b', text)
    if m:
        try: return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3))).date().isoformat()
        except ValueError: pass
    m = re.search(r'\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b', text)
    if m:
        d1, d2, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if d1 > 12 >= d2: day, month = d1, d2
        elif d2 > 12 >= d1: month, day = d1, d2
        else: month, day = d1, d2
        try: return datetime(y, month, day).date().isoformat()
        except ValueError: pass
    return ''

HEADER_LABELS = (
    r'S[Uu0]BJ[Ee3]CT(?:\s+M[Aa]TT[Ee]R)?|S[Uu0]BJ(?:[Ee3]C[TIL1]|\.)?|S[Uu0]B3[Ee3]CT|R[Ee]|R[Ee]G[Aa]RD[Ii]NG|P[Aa]KS[Aa]|'
    r'[Aa]DDR[Ee]SS[Ee]D\s+T[O0]|M[Ee]M[O0]R[Aa]ND[Uu]M\s+F[O0]R|R[Ee]C[Ii]P[Ii][Ee]NT(?:\s+[O0]FF[Ii]C[Ee])?|'
    r'R[Ee]C[Ee][Ii]V[Ee]D\s+FR[O0]M|S[Ee]ND[Ee]R|FR[O0]M|MUL[Aa](?:\s+(?:K[Aa]Y|S[Aa]))?|P[Aa]R[Aa](?:\s+(?:K[Aa]Y|S[Aa]))?|'
    r'[I1]SSU[Ee]D\s+BY|[I1]SSU[Ii]NG\s+[O0]FF[Ii]C[Ee]|[O0]R[Ii]G[Ii]N[Aa]T[Ii]NG\s+[O0]FF[Ii]C[Ee]|S[I1]GN[Aa]T[O0]RY|'
    r'D[Aa@]T[Ee]\s+(?:R[Ee]C[Ee][Ii]V[Ee]D|R[Ee]L[Ee][Aa]S[Ee]D|[I1]SSU[Ee]D)|(?:R[Ee]C[Ee][Ii]V[Ee]D|R[Ee]L[Ee][Aa]S[Ee]D)\s+D[Aa@]T[Ee]|'
    r'D[Aa@]T[Ee]D|D[Aa@]T[Ee]|P[Ee]TS[Aa]|T[O0]|F[O0]R|THR[O0]UGH|THRU|CC|ATTACHM[Ee]NTS?|ENCL[O0]SUR[Ee]S?|'
    r'(?:D[O0]CUM[Ee]NT\s+)?(?:C[O0]NTR[O0]L|TR[Aa]CK[Ii]NG)(?:\s*(?:N[O0]\.?|N[Uu]MB[Ee]R|#))?|'
    r'R[Ee]F(?:[Ee]R[Ee]NC[Ee])?(?:\s+(?:N[O0]\.?|N[Uu]MB[Ee]R))?|REF(?:\.?\s*(?:N[O0]\.?|N[Uu]MB[Ee]R))?|'
    r'D[O0]CUM[Ee]NT\s+TYP[Ee]|C[O0]MMUN[Ii]C[Aa]T[Ii][O0]N\s+TYP[Ee]|D[Ii]R[Ee]CT[Ii][O0]N|ST[Aa]TUS|'
    r'[Aa]CT[Ii][O0]N\s+T[Aa]K[Ee]N|D[Aa@]T[Ee]\s+F[O0]RW[Aa]RD[Ee]D|R[Ee]M[Aa]RKS'
)
HEADER_FIELD = re.compile(r'^(' + HEADER_LABELS + r')\s*(?:[:：;]|[–—-])\s*(.*)$', re.I)
HEADER_BARE = re.compile(r'^(?:' + HEADER_LABELS + r')\s*[:：;]?\s*$', re.I)

MEMO_HEADING = re.compile(
    r'^(?:[A-Z0-9&./-]*\s+){0,6}(?:MEMORANDUM|MEM0RANDUM|MEMO)(?:\s+(?:ORDER|CIRCULAR))?'
    r'(?:\s+(?:N[O0]\.?|NUMBER|FOR|SERIES)\b.*|\s*[:#.-]?\s*\d.*)?$', re.I
)

def primary_document_pages(text):
    pages = str(text or '').replace('\r', '').split('\f')
    for index, page in enumerate(pages):
        top = [line.strip() for line in page.split('\n') if line.strip()][:6]
        if index and any(re.fullmatch(r'(?:ANNEX|APPENDIX|ATTACHMENT|ENCLOSURE)(?:\s+[A-Z0-9IVX.-]+)?\s*[:.—-]?', line, re.I) for line in top):
            break
        yield page

def parse_header(text):
    first = str(text or '').replace('\r', '').split('\f', 1)[0].replace('\u00a0', ' ')
    first = re.sub(r'[ \t|]{2,}(?=(?:' + HEADER_LABELS + r')\s*[:：;])', '\n', first, flags=re.I)
    lines = [tidy(l) for l in first.split('\n')[:140] if tidy(l)]
    boundary = next((i for i, line in enumerate(lines) if BODY.match(line) and not re.match(r'^DEAR\b|^(?:SIR|MADAM)\s*[,!:]', line, re.I)), len(lines))
    lines = lines[:boundary]
    evidence, warnings = {}, []

    def field(names, limit=6):
        wanted = re.compile(r'^(?:' + names + r')\s*[:：;]?$', re.I)
        for i, line in enumerate(lines):
            match = HEADER_FIELD.match(line)
            if not (match and wanted.fullmatch(match[1])) and not wanted.fullmatch(line):
                continue
            parts = [match[2]] if match and match[2] else []
            for following in lines[i + 1:i + 1 + limit]:
                if HEADER_FIELD.match(following) or BODY.match(following) or CLOSING.match(following) or SIGN_LABEL.match(following) or MEMO_HEADING.match(following):
                    break
                if parse_date(following) or re.match(r'^[-_=]{3,}$', following):
                    break
                parts.append(following)
            value = tidy(' '.join(parts))
            if value: return value, line
        return '', ''

    result = {
        'subject': '', 'controlNo': '', 'memoNo': '', 'date': '', 'receivedDate': '', 'releasedDate': '',
        'recipient': '', 'addressedTo': '', 'senderOffice': '', 'signatory': '', 'issuedBy': '',
        'documentType': '', 'isMemo': False, 'fieldEvidence': evidence, 'warnings': warnings
    }

    heading = next((i for i, line in enumerate(lines) if MEMO_HEADING.match(line)), -1)
    if heading >= 0:
        result.update(isMemo=True, documentType='Memorandum')
        block = lines[heading:heading + 5]
        number_text = ' '.join(block)
        number = re.search(r'\b(?:N[O0]\.?|NUMBER)\s*[:#.-]?\s*([A-Z0-9][A-Z0-9/._-]*)', number_text, re.I)
        if not number:
            number = re.search(r'(?:MEMORANDUM|MEM0RANDUM|MEMO)\s*[:#.-]?\s*(\d[\d/._-]*)', lines[heading], re.I)
        if number and re.search(r'\d', number[1]):
            series = re.search(r'(?:[,;]\s*s\.?\s*|\bseries(?:\s+of)?\s+)(\d{4})\b', number_text, re.I)
            result['memoNo'] = number[1] + (', s. ' + series[1] if series else '')
            result['controlNo'] = result['memoNo']
            evidence['controlNo'] = lines[heading]

    for key, names in {
        'subject': r'S[Uu0]BJ[Ee3]CT(?:\s+M[Aa]TT[Ee]R)?|S[Uu0]BJ(?:[Ee3]C[TIL1]|\.)?|R[Ee]|P[Aa]KS[Aa]',
        'recipient': r'T[O0]|F[O0]R|P[Aa]R[Aa](?:\s+(?:K[Aa]Y|S[Aa]))?|[Aa]DDR[Ee]SS[Ee]D\s+T[O0]|M[Ee]M[O0]R[Aa]ND[Uu]M\s+F[O0]R',
        'senderOffice': r'FR[O0]M|MUL[Aa](?:\s+(?:K[Aa]Y|S[Aa]))?|S[Ee]ND[Ee]R|R[Ee]C[Ee][Ii]V[Ee]D\s+FR[O0]M|[O0]R[Ii]G[Ii]N[Aa]T[Ii]NG\s+[O0]FF[Ii]C[Ee]',
        'issuedBy': r'FR[O0]M|[I1]SSU[Ee]D\s+BY|[I1]SSU[Ii]NG\s+[O0]FF[Ii]C[Ee]',
        'signatory': r'S[I1]GN[Aa]T[O0]RY'
    }.items():
        result[key], evidence[key] = field(names, 8 if key == 'subject' else 4)

    result['addressedTo'] = result['recipient']
    control, control_ev = field(r'(?:D[O0]CUM[Ee]NT\s+)?(?:C[O0]NTR[O0]L|TR[Aa]CK[Ii]NG)(?:\s*(?:N[O0]\.?|N[Uu]MB[Ee]R|#))?', 1)
    if not control and not result['controlNo']:
        control, control_ev = field(r'R[Ee]F(?:[Ee]R[Ee]NC[Ee])?(?:\s+(?:N[O0]\.?|N[Uu]MB[Ee]R))?|REF(?:\.?\s*(?:N[O0]\.?|N[Uu]MB[Ee]R))?', 1)
    if control and re.search(r'\d', control):
        result['controlNo'], evidence['controlNo'] = control, control_ev
        if result['isMemo'] and not result['memoNo']: result['memoNo'] = control

    for key, names in {
        'date': r'D[Aa@]T[Ee]|D[Aa@]T[Ee]\s+[I1]SSU[Ee]D|D[Aa@]T[Ee]D|P[Ee]TS[Aa]',
        'receivedDate': r'D[Aa@]T[Ee]\s+R[Ee]C[Ee][Ii]V[Ee]D|R[Ee]C[Ee][Ii]V[Ee]D\s+D[Aa@]T[Ee]',
        'releasedDate': r'D[Aa@]T[Ee]\s+R[Ee]L[Ee][Aa]S[Ee]D|R[Ee]L[Ee][Aa]S[Ee]D\s+D[Aa@]T[Ee]'
    }.items():
        val, evidence[key] = field(names, 1)
        if val: result[key] = parse_date(val)

    if not result['date']:
        standalone = next((line for line in lines if parse_date(line) and len(line) < 35), '')
        if standalone:
            result['date'] = parse_date(standalone)
            evidence['date'] = standalone

    if not result['senderOffice']:
        result['senderOffice'] = letterhead_office(lines[:20])
        evidence['senderOffice'] = result['senderOffice']

    result['needsReview'] = [k for k in ('subject', 'controlNo', 'date', 'recipient', 'senderOffice') if not result[k]]
    return result

def letterhead_office(lines):
    generic = re.compile(r'^(?:OFFICE|DEPARTMENT|BUREAU|DIVISION|COMMISSION|AUTHORITY|UNIVERSITY)$', re.I)
    for line in lines:
        # Do not mistake registry labels or their values for an office name.
        # For example, "ACTION TAKEN: Forwarded to Planning Division" contains
        # the word "Division" but is not the document's letterhead.
        if HEADER_FIELD.match(line) or SIGN_LABEL.match(line):
            continue
        if re.match(r'^(?:STATUS|ACTION\s+TAKEN|DATE\s+FORWARDED|REMARKS?)\s*[:：;–—-]', line, re.I):
            continue
        if re.search(r'\b(?:OFFICE|DEPARTMENT|BUREAU|DIVISION|COMMISSION|AUTHORITY|PROVINCIAL\s+GOVERNMENT|REPUBLIC|MUNICIPALITY)\b', line, re.I):
            if not generic.fullmatch(line) and len(line.split()) >= 2:
                return line
    return ''

# =========================================================================
# MULTI-SIGNAL LETTER TYPE CLASSIFICATION ENGINE
# =========================================================================

LETTER_CLASSIFIER_RULES = [
    {
        'type': 'Memorandum',
        'headings': [
            r'^(?:OFFICE\s+)?(?:MEMORANDUM|MEM0RANDUM|MEMO)(?:\s+(?:ORDER|CIRCULAR|JOINT))?\b',
            r'^MEMORANDUM\s+FOR\b'
        ],
        'subject': [r'\bMEMO\b', r'\bMEMORANDUM\b'],
        'body': [
            r'\bFOR\s+YOUR\s+(?:INFORMATION|GUIDANCE|COMPLIANCE|APPROPRIATE\s+ACTION)\b',
            r'\bBE\s+GUIDED\s+ACCORDINGLY\b',
            r'\bPLEASE\s+BE\s+INFORMED\s+THAT\b',
            r'\bDIRECTED\s+TO\s+COMPLY\b'
        ],
        'structure': r'(?m)^\s*(?:MEMORANDUM\s+FOR|TO)\s*[:：].*^\s*FROM\s*[:：]'
    },
    {
        'type': 'Request Letter',
        'headings': [
            r'^(?:REQUEST\s+LETTER|LETTER\s+OF\s+REQUEST|FORMAL\s+REQUEST|REQUISITION)\b',
            r'^LIHAM\s+KAHILINGAN\b'
        ],
        'subject': [
            r'^(?:REQUEST|APPLICATION|REQUISITION|SOLICITATION|APPEAL|PETITION)\s+(?:FOR|TO|REGARDING)\b',
            r'\b(?:PERMISSION|APPROVAL|ASSISTANCE|FUNDING|DONATION|VEHICLE|EQUIPMENT|SEEDLINGS|CLEARANCE)\s+REQUEST\b',
            r'\b(?:HUMIHILING|HINIHILING|PAKIUSAP)\b'
        ],
        'body': [
            r'\b(?:we|I)\s+(?:would\s+like\s+to|humbly|respectfully|am\s+writing\s+to)\s+request\b',
            r'\b(?:respectfully|humbly)\s+request\b',
            r'\b(?:requesting\s+(?:for|your|the|permission|approval|assistance|consideration))\b',
            r'\bmay\s+(?:we|I)\s+request\b',
            r'\bseek(?:ing)?\s+your\s+(?:approval|assistance|permission|guidance)\b',
            r'\b(?:kami|ako)\s+ay\s+(?:lumalapit|humihiling|umaasa)\b',
            r'\binilalapit\s+po\s+namin\b'
        ]
    },
    {
        'type': 'Endorsement Letter',
        'headings': [
            r'^(?:(?:1ST|2ND|3RD|4TH|[0-9]+(?:ST|ND|RD|TH))\s+)?(?:INDORSEMENT|ENDORSEMENT)(?:\s+LETTER)?\b',
            r'^LETTER\s+OF\s+(?:IN|EN)DORSEMENT\b',
            r'^PAG-?EENDORSO\b'
        ],
        'subject': [
            r'^(?:(?:1ST|2ND|3RD|[0-9]+TH)\s+)?(?:IN|EN)DORSEMENT\b',
            r'\b(?:IN|EN)DORSING\s+THE\b'
        ],
        'body': [
            r'\b(?:respectfully|hereby)\s+(?:referred|endorsed|forwarded|transmitted)\s+to\b',
            r'\b(?:we|I)\s+(?:hereby\s+)?endorse\b',
            r'\brecommending\s+(?:favorable\s+)?approval\b',
            r'\bfor\s+(?:appropriate\s+action|favorable\s+consideration|notation)\b',
            r'\blubos\s+na\s+nag-?eendorso\b'
        ]
    },
    {
        'type': 'Transmittal Letter',
        'headings': [
            r'^(?:TRANSMITTAL(?:\s+LETTER)?|LETTER\s+OF\s+TRANSMITTAL)\b',
            r'^LIHAM\s+PAGHAHATID\b'
        ],
        'subject': [
            r'^(?:TRANSMITTAL|FORWARDING|SUBMISSION)\s+(?:OF|FOR)\b',
            r'\bSUBMISSION\s+OF\s+(?:DOCUMENTS|REPORTS|REQUIREMENTS|INVENTORY)\b',
            r'\bLAKIP\s+NITO\b'
        ],
        'body': [
            r'\b(?:herewith|hereby|respectfully)\s+(?:transmit|transmitting|forward|forwarding|submit|submitting)\b',
            r'\btransmitting\s+herewith\s+(?:the\s+following|attached|copies)\b',
            r'\bfor\s+your\s+(?:perusal|records|reference|safe\s+keeping|review)\b',
            r'\blakip\s+nito\s+ang\s+mga\b',
            r'\bipinagkakaloob\s+namin\b'
        ]
    },
    {
        'type': 'Response Letter',
        'headings': [
            r'^(?:RESPONSE(?:\s+LETTER)?|REPLY(?:\s+LETTER)?|LETTER\s+OF\s+REPLY)\b',
            r'^LIHAM\s+PAGTUGON\b'
        ],
        'subject': [
            r'^(?:RESPONSE|REPLY)\s+TO\b',
            r'\bIN\s+RESPONSE\s+TO\s+(?:YOUR|THE)\b',
            r'\bREPLY\s+REGARDING\b',
            r'\bSAGOT\s+SA\b'
        ],
        'body': [
            r'\bin\s+(?:response|reply|reference)\s+to\s+your\s+(?:letter|query|request|inquiry|communication)\b',
            r'\bthis\s+is\s+in\s+reference\s+to\s+your\s+letter\s+dated\b',
            r'\bwith\s+regards?\s+to\s+your\s+request\s+dated\b',
            r'\bbilang\s+pagtugon\s+sa\s+inyong\s+(?:liham|kahilingan)\b',
            r'\bsagot\s+sa\s+inyong\s+pagsusuri\b'
        ]
    },
    {
        'type': 'Notice of Meeting',
        'headings': [
            r'^(?:NOTICE\s+OF\s+(?:A\s+)?MEETING|MEETING\s+NOTICE|CALL\s+TO\s+MEETING)\b',
            r'^PAANYAYA\s+SA\s+PULONG\b',
            r'^PABATID\s+UKOL\s+SA\s+PULONG\b'
        ],
        'subject': [
            r'^(?:NOTICE\s+OF\s+(?:A\s+)?MEETING|MEETING\s+NOTICE)\b',
            r'\b(?:COORDINATION|REGULAR|SPECIAL|EMERGENCY|STAFF|EXECUTIVE)\s+MEETING\b',
            r'\bPAGPUPULONG\b'
        ],
        'body': [
            r'\bplease\s+be\s+informed\s+that\s+there\s+will\s+be\s+a\s+meeting\b',
            r'\byou\s+are\s+(?:hereby\s+)?(?:invited|requested|directed)\s+to\s+attend\s+(?:the|a)\s+meeting\b',
            r'\bagenda\s*[:：]',
            r'\bmeeting\s+(?:will\s+be\s+held|is\s+scheduled)\s+on\b',
            r'\bpulong\s+sa\s+darating\s+na\b'
        ]
    },
    {
        'type': 'Invitation',
        'headings': [
            r'^(?:INVITATION(?:\s+LETTER)?|LETTER\s+OF\s+INVITATION|FORMAL\s+INVITATION)\b',
            r'^PAANYAYA\b'
        ],
        'subject': [
            r'^(?:INVITATION|PAANYAYA)\s+(?:TO|FOR)\b',
            r'\bINVITATION\s+AS\s+(?:GUEST|SPEAKER|JUDGE|PARTICIPANT)\b',
            r'\bINAGURATION|COMMENCEMENT|CONFERENCE|CEREMONY\b'
        ],
        'body': [
            r'\b(?:cordially|warmly|respectfully)\s+invite\s+you\b',
            r'\bextend\s+(?:our|an)\s+invitation\s+to\b',
            r'\bwould\s+like\s+to\s+invite\s+you\b',
            r'\bto\s+grace\s+the\s+occasion\b',
            r'\bkami\s+po\s+ay\s+nag-aanyaya\b',
            r'\binaanyayahan\s+po\s+namin\s+kayo\b'
        ]
    },
    {
        'type': 'Report',
        'headings': [
            r'^(?:(?:MONTHLY|ANNUAL|ACCOMPLISHMENT|ACTIVITY|INSPECTION|PROGRESS|INCIDENT|NARRATIVE|TERMINAL|FINANCIAL)\s+){1,3}REPORT\b',
            r'^ULAT\s+(?:NG|SA)\b'
        ],
        'subject': [
            r'\b(?:PROGRESS|ACCOMPLISHMENT|STATUS|INSPECTION|ACTIVITY|ANNUAL)\s+REPORT\b',
            r'\bREPORT\s+FOR\s+THE\s+MONTH\s+OF\b'
        ],
        'body': [
            r'\b(?:this|the\s+following)\s+report\s+(?:presents|details|summarizes|highlights)\b',
            r'\baccomplishments\s+for\s+the\s+period\b',
            r'\bfindings\s+and\s+observations\b',
            r'\baction\s+taken\s+and\s+recommendations\b'
        ]
    },
    {
        'type': 'Office Order',
        'headings': [r'^(?:OFFICE|ADMINISTRATIVE)\s+ORDER(?:\s+(?:N[O0]\.?|NUMBER|SERIES))?\b'],
        'subject': [r'\bOFFICE\s+ORDER\b', r'\bDESIGNATION\s+AS\b'],
        'body': [r'\bin\s+the\s+interest\s+of\s+(?:the\s+)?service\b', r'\bhereby\s+designated\s+as\b']
    },
    {
        'type': 'Special Order',
        'headings': [r'^SPECIAL\s+ORDER(?:\s+(?:N[O0]\.?|NUMBER|SERIES))?\b'],
        'subject': [r'\bSPECIAL\s+ORDER\b'],
        'body': [r'\bhereby\s+reassigned\b', r'\bconstituting\s+the\s+(?:team|committee)\b']
    },
    {
        'type': 'Travel Order',
        'headings': [r'^(?:REVISED\s+)?TRAVEL\s+ORDER(?:\s+(?:N[O0]\.?|NUMBER|SERIES))?\b'],
        'subject': [r'\bTRAVEL\s+ORDER\b', r'\bAUTHORITY\s+TO\s+TRAVEL\b'],
        'body': [r'\byou\s+are\s+hereby\s+(?:authorized|directed)\s+to\s+travel\b', r'\bdestination\s*[:：]']
    }
]

def classify_letter_type(raw_text='', extracted_subject=''):
    clean = str(raw_text or '').replace('\r', '').split('\f', 1)[0]
    lines = [tidy(l) for l in clean.split('\n') if tidy(l)]
    top_lines = lines[:20]
    top_block = ' '.join(top_lines)
    body_block = ' '.join(lines[:45])
    subject_text = str(extracted_subject or '').strip()

    scores = {}
    evidence_map = {}

    for rule in LETTER_CLASSIFIER_RULES:
        t = rule['type']
        scores[t] = 0
        evidence_map[t] = []

        for pat in rule.get('headings', []):
            # Headings often follow the government letterhead. Test each line
            # separately so anchored patterns such as ^REQUEST LETTER still match.
            m = next((match for line in top_lines if (match := re.search(pat, line, re.I))), None)
            if m:
                scores[t] += 60
                evidence_map[t].append(f"Header: '{m.group(0)}'")
                break

        if subject_text:
            for pat in rule.get('subject', []):
                m = re.search(pat, subject_text, re.I)
                if m:
                    scores[t] += 45
                    evidence_map[t].append(f"Subject: '{m.group(0)}'")
                    break

        for pat in rule.get('body', []):
            m = re.search(pat, body_block, re.I)
            if m:
                scores[t] += 30
                evidence_map[t].append(f"Body: '{m.group(0)}'")
                break

        if 'structure' in rule:
            if re.search(rule['structure'], clean, re.I):
                scores[t] += 25
                evidence_map[t].append("Layout matched")

    best_type = max(scores, key=scores.get) if scores else ''
    best_score = scores.get(best_type, 0)
    salutation_seen = bool(re.search(r'(?m)^(?:DEAR\b|SIR\s*[,!:]|MADAM\s*[,!:]|MA\'AM\s*[,!:]|TO\s+WHOM|GREETINGS)', clean, re.I))

    if best_score >= 30:
        detected_type = best_type
        confidence = 'high' if best_score >= 60 else 'medium'
        evidence = ' | '.join(evidence_map[best_type])
    elif salutation_seen:
        detected_type = 'Letter'
        confidence = 'medium'
        evidence = 'Standard formal letter structure with salutation'
    else:
        detected_type = 'Other Communication'
        confidence = 'low'
        evidence = 'General administrative content'

    return {
        'documentType': detected_type,
        'confidence': confidence,
        'evidence': evidence,
        'score': best_score
    }

def parse_letter_details(raw_text=''):
    first = str(raw_text or '').replace('\r', '').split('\f', 1)[0]
    lines = [tidy(line) for line in first.split('\n') if tidy(line)]
    subject = ''
    opening = ''
    printed_subject = False

    for index, line in enumerate(lines[:80]):
        match = re.match(
            r'^(?:S[Uu0]BJ[Ee3]CT(?:\s+M[Aa]TT[Ee]R)?|S[Uu0]BJ(?:[Ee3]C[TIL1]|\.)?|R[Ee](?=\s*[:：;\-])|P[Aa]KS[Aa])\s*[:：;\-]?\s*(.*)$',
            line,
            re.I,
        )
        if match:
            parts = [match.group(1)] if match.group(1) else []
            for following in lines[index + 1:min(len(lines), index + 6)]:
                if FIELD_LABEL.match(following) or BODY.match(following) or CLOSING.match(following):
                    break
                parts.append(following)
            subject = tidy(' '.join(parts))
            printed_subject = bool(subject)
            break
        if not opening and re.match(r'^(?:DEAR\b|SIR\s*[,!:]|MADAM\s*[,!:]|MA.M\s*[,!:]|GREETINGS\b|GOOD\s+(?:DAY|MORNING|AFTERNOON)\b|TO\s+WHOM\b)', line, re.I):
            continue
        if not opening and not CLOSING.match(line) and (
            BODY.match(line)
            or re.match(r'^[|!¦]?\s*(?:(?:I|WE)\s+)?(?:respectfully|humbly)\s+request\b', line, re.I)
            or re.match(r'^(?:I|WE)\s+(?:hereby|would\s+like\s+to|am\s+writing\s+to|wish\s+to|request|seek)\b', line, re.I)
        ):
            opening = re.sub(r'^[|!¦]\s*(?=respectfully\s+request)', 'I ', ' '.join(lines[index:index + 3]), flags=re.I).strip()
            opening = re.sub(r'^[|!¦]\s*', '', opening).strip()

    if not subject and opening:
        match = re.match(r'^.*?[.!?](?=\s+[A-Z]|$)', opening)
        subject = match.group(0) if match else opening[:180] + '…'

    classification = classify_letter_type(raw_text, subject)
    needs_review = []
    if not printed_subject:
        needs_review.append('subject')
    if classification['confidence'] != 'high' or classification['documentType'] == 'Other Communication':
        needs_review.append('documentType')

    return {
        'subject': subject,
        'subjectSource': 'printed' if printed_subject else 'body',
        'subjectEvidence': subject,
        'documentType': classification['documentType'],
        'documentTypeSource': classification['confidence'],
        'documentTypeEvidence': classification['evidence'],
        'needsReview': needs_review,
    }

FORM_FIELD_PATTERNS = {
    'status': r'(?:RECORD\s+)?STATUS',
    'actionTaken': r'(?:ACTION\s+TAKEN(?:\s*/\s*DATE\s+FORWARDED)?|ACTION\s*/\s*DATE\s+FORWARDED|DATE\s+FORWARDED)',
    'remarks': r'(?:REMARKS?|NOTES?)',
}


def _read_labeled_form_value(text, label_pattern, max_lines=3):
    """Read only explicitly labelled registry fields, never infer them from letter prose."""
    first_page = str(text or '').replace('\r', '').split('\f', 1)[0]
    lines = first_page.splitlines()
    label = rf'(?:{label_pattern})'
    inline_pattern = re.compile(
        rf'^\s*{label}\s*(?::|：|;|–|—|-)\s*(.*?)\s*$',
        re.I,
    )
    bare_pattern = re.compile(rf'^\s*{label}\s*$', re.I)
    for index, raw_line in enumerate(lines[:160]):
        line = raw_line.strip()
        match = inline_pattern.match(line)
        if match:
            value = tidy(match.group(1))
            if value:
                return value, line
        elif not bare_pattern.fullmatch(line):
            continue

        parts = []
        for following in lines[index + 1:index + 1 + max_lines]:
            candidate = tidy(following)
            if not candidate:
                if parts:
                    break
                continue
            if (
                inline_pattern.match(candidate)
                or bare_pattern.fullmatch(candidate)
                or FIELD_LABEL.match(candidate)
                or BODY.match(candidate)
                or CLOSING.match(candidate)
            ):
                break
            parts.append(candidate)
        value = tidy(' '.join(parts))
        if value:
            return value, line + '\n' + value
    return '', ''


def extract_registry_form_fields(text):
    """Extract optional workflow fields when a document labels them explicitly."""
    raw_status, status_evidence = _read_labeled_form_value(
        text, FORM_FIELD_PATTERNS['status'], max_lines=1
    )
    normalized_status = re.sub(r'[^a-z]+', ' ', raw_status.casefold()).strip()
    status = ''
    status_aliases = {
        'pending': 'Pending',
        'for action': 'Pending',
        'for review': 'Pending',
        'awaiting action': 'Pending',
        'received': 'Received',
        'received and logged': 'Received',
        'logged': 'Received',
        'accepted': 'Received',
        'forwarded': 'Forwarded',
        'routed': 'Forwarded',
        'endorsed': 'Forwarded',
        'released': 'Released',
        'sent out': 'Released',
        'dispatched': 'Released',
        'archived': 'Archived',
        'filed': 'Archived',
    }
    status = status_aliases.get(normalized_status, '')

    action_taken, action_evidence = _read_labeled_form_value(
        text, FORM_FIELD_PATTERNS['actionTaken'], max_lines=3
    )
    remarks, remarks_evidence = _read_labeled_form_value(
        text, FORM_FIELD_PATTERNS['remarks'], max_lines=3
    )

    evidence = {}
    if status:
        evidence['status'] = status_evidence
    if action_taken:
        evidence['actionTaken'] = action_evidence
    if remarks:
        evidence['remarks'] = remarks_evidence

    return {
        'status': status,
        'statusSource': 'printed' if status else '',
        'actionTaken': action_taken,
        'actionTakenSource': 'printed' if action_taken else '',
        'remarks': remarks,
        'remarksSource': 'printed' if remarks else '',
        'fieldEvidence': evidence,
    }


def extract_document_metadata(text):
    header = parse_header(text)
    details = parse_letter_details(text)
    sender = parse_correspondence(text)
    registry_fields = extract_registry_form_fields(text)

    if not sender['recipient']:
        lines = [tidy(l) for l in str(text).split('\f', 1)[0].splitlines() if tidy(l)]
        greet_idx = next((i for i, l in enumerate(lines) if re.match(r'^Dear\b|^(?:Sir|Madam|Ma.am)\s*[:,]', l, re.I)), -1)
        if greet_idx > 0:
            block = lines[max(0, greet_idx - 6):greet_idx]
            sender['recipient'] = ' '.join(block)

    source_office = sender.get('sender') or header.get('senderOffice') or ''
    received_from = sender.get('receivedFrom') or ''
    received_from_source = sender.get('receivedFromSource') or 'missing'
    received_from_needs_review = bool(sender.get('receivedFromNeedsReview'))
    combined_review = list(dict.fromkeys(header['needsReview'] + details['needsReview'] + sender['needsReview']))
    # If a printed originating office is available but the letter has no
    # person-name signatory, use that explicit office in the required
    # "Received from" field. Ambiguous person candidates still require review.
    if not received_from and source_office and received_from_source == 'missing':
        received_from = source_office
        received_from_source = 'office'
        received_from_needs_review = False
        combined_review = [key for key in combined_review if key != 'receivedFrom']

    result = {
        **header, **sender,
        'receivedFrom': received_from,
        'receivedFromSource': received_from_source,
        'receivedFromNeedsReview': received_from_needs_review,
        'subject': header['subject'] or details['subject'],
        'subjectSource': 'header' if header['subject'] else details['subjectSource'],
        'documentType': header['documentType'] or details['documentType'],
        'documentTypeSource': 'heading' if header['documentType'] else details['documentTypeSource'],
        'issuedBy': sender['signatory'] or header['issuedBy'] or sender['sender'],
        'sourceOffice': sender['sender'],
        'status': registry_fields['status'],
        'statusSource': registry_fields['statusSource'],
        'actionTaken': registry_fields['actionTaken'],
        'actionTakenSource': registry_fields['actionTakenSource'],
        'remarks': registry_fields['remarks'],
        'remarksSource': registry_fields['remarksSource'],
        'detectedNumbers': extract_numeric_tokens(text),
        'fieldEvidence': {
            **header['fieldEvidence'], **sender['fieldEvidence'], **registry_fields['fieldEvidence'],
            'receivedFrom': sender['fieldEvidence'].get('receivedFrom') or (source_office if received_from_source == 'office' else ''),
            'subject': header['fieldEvidence'].get('subject') or details['subject'],
            'documentType': header['documentType'] or details['documentType']
        },
        'needsReview': combined_review
    }
    return result

def extract_numeric_tokens(text):
    return list(dict.fromkeys(re.findall(r'(?<!\w)\d[\d,./:-]*', text or '')))

def communication_form_payload(metadata, text, communication_type=''):
    evidence = dict(metadata.get('fieldEvidence') or {})
    direction = communication_type if communication_type in ('Incoming', 'Outgoing') else 'Incoming'
    memo = bool(metadata.get('isMemo') or metadata.get('documentType') == 'Memorandum')
    uncertain = set(metadata.get('needsReview') or [])
    received = metadata.get('receivedFrom') or ''
    if 'receivedFrom' in uncertain: received = ''

    values = {
        'controlNoInput': (metadata.get('memoNo') if memo else '') or metadata.get('controlNo') or '',
        'docTypeSelect': metadata.get('documentType') or 'Other Communication',
        'subjectInput': metadata.get('subject') or '',
        'officeInput': (metadata.get('recipient') or metadata.get('addressedTo') or '') if direction == 'Outgoing' else (received or metadata.get('sourceOffice') or metadata.get('senderOffice') or ''),
        'dateInput': (metadata.get('date') if memo else metadata.get('releasedDate' if direction == 'Outgoing' else 'receivedDate')) or metadata.get('date') or '',
        'statusSelect': metadata.get('status') or '',
        'actionTakenInput': metadata.get('actionTaken') or '',
        'remarksInput': metadata.get('remarks') or ''
    }
    if memo:
        values['memoRecipientInput'] = metadata.get('recipient') or ''
        values['memoIssuerInput'] = '' if 'receivedFrom' in uncertain else metadata.get('signatory') or metadata.get('issuedBy') or ''

    states = {}
    office_key = 'recipient' if direction == 'Outgoing' else (
        'receivedFrom' if received else 'sourceOffice' if values.get('officeInput') else 'receivedFrom'
    )
    keys = {'controlNoInput': 'controlNo', 'docTypeSelect': 'documentType', 'subjectInput': 'subject',
            'officeInput': office_key, 'dateInput': 'date',
            'statusSelect': 'status', 'actionTakenInput': 'actionTaken', 'remarksInput': 'remarks',
            'memoRecipientInput': 'recipient', 'memoIssuerInput': 'receivedFrom'}
    for input_id, value in values.items():
        key = keys[input_id]
        review = key in uncertain or (key == 'receivedFrom' and metadata.get('receivedFromNeedsReview'))
        if input_id == 'dateInput' and not memo and not metadata.get('releasedDate' if direction == 'Outgoing' else 'receivedDate'):
            review = True
        states[input_id] = {
            'state': 'missing' if not value else 'review' if review else 'detected',
            'source': metadata.get(key + 'Source', 'ocr'), 'evidence': evidence.get(key, '')
        }
    required = ['controlNoInput', 'docTypeSelect', 'dateInput', 'subjectInput', 'memoRecipientInput' if memo else 'officeInput']
    return {
        'formSchemaVersion': 1,
        'formValues': values,
        'fieldStates': states,
        'missingFields': [k for k in required if not values.get(k)],
        'reviewFields': [k for k, s in states.items() if s['state'] == 'review'],
        'route': 'office_memos' if memo else 'communications',
        'communicationType': direction
    }

# =========================================================================
# ADAPTIVE MULTI-ZONE OCR EXECUTION
# =========================================================================

def supplement_sender_evidence(base, extra, signature_region=False):
    """Add only evidenced missing names, without duplicating whole-page OCR text."""
    existing = parse_correspondence(base)
    if existing['receivedFrom'] or existing['receivedFromSource'] == 'ambiguous': return base
    candidates = scan_sender_candidates(extra, signature_region)['primary']
    proof = '\n\n'.join(c['evidence'] for c in candidates)
    if not proof: return base
    if all(c['kind'] == 'explicit-sender' for c in candidates): return proof + '\n\n' + base
    tail = re.search(r'^\s*(?:CC\s*:|COPY\s+(?:TO|FURNISHED)|ANNEX\b|APPENDIX\b|ATTACHMENTS?\s*:|ENCLOSURES?\s*:)', base, re.I|re.M)
    at = tail.start() if tail else len(base)
    return base[:at].rstrip() + '\n\n' + proof + '\n\n' + base[at:]


def detect_page_rotation(image):
    """Ask Tesseract OSD whether a scan is sideways or upside down."""
    if not (shutil.which(TESSERACT_CMD) or Path(TESSERACT_CMD).is_file()):
        return 0
    acquired = False
    try:
        while not _ocr_slots.acquire(timeout=min(.2, check_budget())):
            check_budget()
        acquired = True
        with tempfile.TemporaryDirectory(prefix='pgenro_osd_') as folder:
            path = Path(folder) / 'orientation.png'
            image.convert('RGB').save(path, 'PNG')
            env = os.environ.copy()
            env.setdefault('OMP_THREAD_LIMIT', '1')
            result = subprocess.run(
                [TESSERACT_CMD, str(path), 'stdout', '-l', 'osd', '--psm', '0'],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=min(8, check_budget()),
                env=env,
                check=False,
            )
            if result.returncode:
                return 0
            rotation = re.search(r'(?im)^\s*Rotate:\s*(0|90|180|270)\s*$', result.stdout)
            confidence = re.search(r'(?im)^\s*Orientation confidence:\s*([0-9.]+)', result.stdout)
            if not rotation:
                return 0
            confidence_value = float(confidence.group(1)) if confidence else 0
            return int(rotation.group(1)) if confidence_value >= 1.5 else 0
    except (OSError, ValueError, subprocess.SubprocessError, ReadCancelled, DocumentTimeout):
        return 0
    finally:
        if acquired:
            _ocr_slots.release()


def _otsu_binarize(image):
    """Create a high-contrast alternate for faint or unevenly scanned pages."""
    gray = ImageOps.grayscale(image)
    histogram = gray.histogram()
    total = sum(histogram)
    if not total:
        return gray
    weighted = sum(level * count for level, count in enumerate(histogram))
    background_weight = 0
    background_sum = 0
    best_variance = -1
    threshold = 127
    for level, count in enumerate(histogram):
        background_weight += count
        if background_weight == 0:
            continue
        foreground_weight = total - background_weight
        if foreground_weight == 0:
            break
        background_sum += level * count
        background_mean = background_sum / background_weight
        foreground_mean = (weighted - background_sum) / foreground_weight
        variance = background_weight * foreground_weight * (background_mean - foreground_mean) ** 2
        if variance > best_variance:
            best_variance = variance
            threshold = level
    return gray.point(lambda pixel: 255 if pixel > threshold else 0)


def _ocr_candidate_score(candidate):
    """Prefer legible OCR that also captures useful letter-header evidence."""
    text = clean_text(candidate.get('text', ''))
    if not text:
        return -1
    confidence = float(candidate.get('confidence') or 0)
    words = re.findall(r'[\wÀ-ž]+', text, re.UNICODE)
    score = confidence + min(12, len(words) * 0.08)
    header = parse_header(text)
    details = parse_letter_details(text)
    sender = parse_correspondence(text)
    score += 6 if header.get('subject') else 0
    score += 4 if header.get('date') or header.get('receivedDate') or header.get('releasedDate') else 0
    score += 4 if header.get('controlNo') else 0
    score += 7 if sender.get('receivedFrom') else 0
    score += 3 if details.get('documentType') not in ('', 'Other Communication') else 0
    return score


def fast_ocr_image(image, header_metadata=None):
    check_budget()
    image = trim_blank_margins(resize_ocr_image(opaque_image(image)))
    processed = preprocess_image_for_ocr(image, resize=False)
    extrema = processed.getextrema()
    if extrema[1] - extrema[0] < 8:
        return ''
    page_key = f'{OCR_PARSER_VERSION}:{OCR_LANG}:{processed.size}:' + hashlib.sha256(processed.tobytes()).hexdigest()
    with _page_cache_lock:
        cached = _page_cache.get(page_key)
        if cached and time.monotonic() - cached[0] <= OCR_CACHE_TTL:
            if cached[1].get('lowConfidence'):
                mark_sender_ocr_review()
            return cached[1]['text']

    first = run_tesseract(processed, 3, with_data=True)
    # Orientation detection is conditional: clear portrait scans skip the extra
    # process, while low-confidence or landscape scans get an OSD check.
    if first.get('confidence', 0) < max(OCR_MIN_CONFIDENCE, 78) or image.width > image.height:
        rotation = detect_page_rotation(processed)
        if rotation:
            oriented = processed.rotate(-rotation, expand=True, fillcolor=255)
            oriented_result = run_tesseract(oriented, 3, with_data=True)
            if _ocr_candidate_score(oriented_result) > _ocr_candidate_score(first):
                processed, first = oriented, oriented_result

    candidates = [first]
    first_text = first.get('text', '')
    first_header = parse_header(first_text)
    first_sender = parse_correspondence(first_text)
    header_gaps = sum(not first_header.get(key) for key in ('subject', 'date', 'controlNo'))
    # A readable body can still have a missed header or signature. Try a
    # single-column layout whenever the first pass is weak or incomplete.
    needs_alternate = (
        not first_text.strip()
        or first['confidence'] < max(OCR_MIN_CONFIDENCE, 72)
        or not first_sender.get('receivedFrom')
        or header_gaps >= 2
    )
    if needs_alternate:
        alternate = run_tesseract(processed, 6, with_data=True)
        candidates.append(alternate)

    best = max(candidates, key=_ocr_candidate_score)
    text = best.get('text', '')

    # If a layout pass finds the sender more clearly than the selected pass,
    # retain the sender evidence without duplicating the rest of the page.
    if not parse_correspondence(text).get('receivedFrom'):
        for candidate in candidates:
            if candidate is best:
                continue
            supplemented = supplement_sender_evidence(text, candidate.get('text', ''))
            if supplemented != text:
                text = supplemented
                if parse_correspondence(text).get('receivedFrom'):
                    if _ocr_candidate_score(candidate) >= _ocr_candidate_score(best) - 2:
                        best = candidate
                    break

    # Faint scans and low-contrast phone photos benefit from a binarized pass.
    # Keep it conditional so clear documents remain fast.
    if best.get('confidence', 0) < max(OCR_MIN_CONFIDENCE, 68) or len(re.findall(r'\S+', text)) < 18:
        thresholded = _otsu_binarize(processed)
        alternate = run_tesseract(thresholded, 6, with_data=True)
        candidates.append(alternate)
        if _ocr_candidate_score(alternate) > _ocr_candidate_score(best):
            best = alternate
            text = alternate.get('text', '')
        if not parse_correspondence(text).get('receivedFrom'):
            for candidate in candidates:
                if candidate is best:
                    continue
                supplemented = supplement_sender_evidence(text, candidate.get('text', ''))
                if supplemented != text:
                    text = supplemented
                    if parse_correspondence(text).get('receivedFrom'):
                        break

    corr = parse_correspondence(text)
    # A cropped region needs an explicit signature marker or nearby role. Never
    # promote an isolated recipient/body name merely because it appears in a crop.
    if not corr['receivedFrom'] and corr['receivedFromSource'] != 'ambiguous' and processed.height > 500:
        crop = processed.crop((0, int(processed.height * .48), processed.width, processed.height))
        alternate = run_tesseract(crop, 11, with_data=True)
        scan = scan_sender_candidates(alternate['text'], True)
        strong = [c for c in scan['primary'] if c['kind'] == 'signature' and c['role']]
        # A person already visible in the full page without sender evidence is
        # probably an addressee/list entry. Do not upgrade it from a crop.
        strong = [c for c in strong if sender_name_key(c['name']) not in sender_name_key(text)]
        if strong:
            proof = '\n\n'.join(c['evidence'] for c in strong)
            supplemented = supplement_sender_evidence(text, proof, True)
            if supplemented != text:
                best, text = alternate, supplemented

    current = _state.get()
    low = best.get('confidence', 0) < OCR_MIN_CONFIDENCE
    # Inspect confidence for the printed name itself, not only the body average.
    selected = parse_correspondence(text)['receivedFrom']
    if selected:
        name_tokens = set(re.findall(r'[^\W\d_]+', selected.casefold()))
        name_conf = [
            word['conf'] for word in best.get('words', [])
            if re.sub(r'[^\w]', '', word['text'].casefold()) in name_tokens
        ]
        low = low or bool(name_conf and min(name_conf) < 45)
    if current:
        with current.lock:
            current.confidences.append(best.get('confidence', 0))
    if low:
        mark_sender_ocr_review()
    if OCR_PAGE_CACHE_SIZE and len(text) <= 128000:
        with _page_cache_lock:
            _page_cache[page_key] = (time.monotonic(), {'text': text, 'lowConfidence': low})
            while len(_page_cache) > OCR_PAGE_CACHE_SIZE:
                _page_cache.popitem(last=False)
    return text


def mark_sender_ocr_review():
    current = _state.get()
    if current:
        with current.lock: current.review_fields.add('receivedFrom')
    warn('Some scanned text has low OCR confidence. Confirm the printed sender name against the original.')


def extract_pdf(file_path):
    with pdf_access(), fitz.open(file_path) as doc:
        if doc.needs_pass: raise ValueError('PDF is password protected.')
        output = [''] * len(doc)
        reading_progress(total=len(doc), stage='Processing PDF pages')
        for i, page in enumerate(doc):
            check_budget()
            native = clean_text(page.get_text('text', sort=True))
            usable = len(re.findall(r'[^\W_]', native)) >= 80 and '\ufffd' not in native
            # A digital body can coexist with a scanned signatory. Inspect images
            # instead of accepting the body character count as proof of completeness.
            has_images = bool(page.get_images(full=True))
            sender = parse_correspondence(native)
            needs_scan = not usable or (has_images and not sender['receivedFrom'])
            if needs_scan:
                scale = min(OCR_DPI/72, OCR_MAX_SIDE/max(page.rect.width, page.rect.height))
                pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csRGB, alpha=False)
                scanned = fast_ocr_image(Image.frombytes('RGB', (pix.width, pix.height), pix.samples))
                output[i] = supplement_sender_evidence(native, scanned) if usable else scanned or native
            else: output[i] = native
            reading_progress(completed=i+1)
        return '\n\f\n'.join(output)


def read_office_document(file_path, extension):
    """Read OOXML text and document-positioned images without extracting a ZIP."""
    with zipfile.ZipFile(file_path) as archive:
        infos = archive.infolist()
        if len(infos) > 5000 or sum(i.file_size for i in infos) > 150*1024*1024:
            raise ValueError('The expanded Office document exceeds the reading limit.')
        names = set(archive.namelist())
        def xml(part):
            check_budget()
            raw = archive.read(part)
            if b'<!DOCTYPE' in raw or b'<!ENTITY' in raw: raise ValueError('Unsupported XML declaration.')
            return ET.fromstring(raw)
        def local(tag): return tag.rsplit('}',1)[-1]
        def number(part):
            match = re.search(r'(\d+)\.xml$', part)
            return int(match[1]) if match else 0
        def part_text(part):
            node = xml(part)
            relfile = posixpath.join(posixpath.dirname(part), '_rels', posixpath.basename(part)+'.rels')
            rels = {}
            if relfile in names:
                for rel in xml(relfile):
                    if rel.get('TargetMode') != 'External':
                        target = rel.get('Target','')
                        rels[rel.get('Id')] = target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join(posixpath.dirname(part), target))
            seen, lines = set(), []
            for para in node.iter():
                if local(para.tag) != 'p': continue
                chunks = []
                for child in para.iter():
                    tag = local(child.tag)
                    if tag == 't': chunks.append(child.text or '')
                    elif tag == 'tab': chunks.append('  ')
                    elif tag in ('br','cr'): chunks.append('\n')
                    elif tag == 'blip':
                        embed = next((v for k,v in child.attrib.items() if local(k) == 'embed'), None)
                        media = rels.get(embed)
                        if media and media in names and media not in seen:
                            seen.add(media)
                            try:
                                with Image.open(io.BytesIO(archive.read(media))) as img: chunks.append('\n'+fast_ocr_image(img)+'\n')
                            except (UnidentifiedImageError, OSError): warn('An embedded image could not be read; confirm the document manually.')
                if chunks: lines.append(''.join(chunks))
            return '\n'.join(lines)
        if extension == 'docx':
            selected = sorted((n for n in names if re.fullmatch(r'word/header\d+\.xml',n)),key=number)+['word/document.xml']+sorted((n for n in names if re.fullmatch(r'word/footer\d+\.xml',n)),key=number)
        elif extension == 'pptx':
            selected = sorted((n for n in names if re.fullmatch(r'ppt/slides/slide\d+\.xml',n)),key=number)
        else:
            selected = sorted((n for n in names if re.fullmatch(r'xl/worksheets/sheet\d+\.xml',n)),key=number)
        selected = [n for n in selected if n in names]
        if not selected: raise ValueError('No readable Office document parts were found.')
        reading_progress(total=len(selected),stage='Reading Office document')
        parts = []
        shared = []
        if extension == 'xlsx' and 'xl/sharedStrings.xml' in names:
            shared = [''.join(t.text or '' for t in si.iter() if local(t.tag)=='t') for si in xml('xl/sharedStrings.xml')]
        for index, part in enumerate(selected):
            if extension == 'xlsx':
                rows=[]
                for row in xml(part).iter():
                    if local(row.tag) != 'row': continue
                    cells=[]
                    for cell in row:
                        value = ''.join(c.text or '' for c in cell.iter() if local(c.tag) in ('v','t'))
                        if cell.get('t') == 's': value = shared[int(value)] if value.isdigit() and int(value)<len(shared) else ''
                        cells.append(value)
                    rows.append('  '.join(cells))
                parts.append('\n'.join(rows))
            else: parts.append(part_text(part))
            reading_progress(completed=index+1)
        if extension == 'xlsx': warn('Spreadsheet text was read. Embedded drawings and images in worksheets require manual review.')
        return ('\n' if extension=='docx' else '\n\f\n').join(parts)


def read_document(file_path, extension):
    if extension == 'pdf': text = extract_pdf(file_path)
    elif extension in {'png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff'}:
        pages = []
        with Image.open(file_path) as src:
            total = getattr(src, 'n_frames', 1)
            reading_progress(total=total, stage='Processing scan pages')
            # Copy frames as we advance; PIL frame iterators otherwise alias the
            # same image and can silently repeat the final page of a TIFF.
            for i in range(total):
                check_budget(); src.seek(i)
                pages.append(fast_ocr_image(src.copy()))
                reading_progress(completed=i+1)
        text = '\n\f\n'.join(pages)
    elif extension in {'txt', 'csv'}:
        raw = Path(file_path).read_bytes()
        encoding = 'utf-16' if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig'
        text = raw.decode(encoding, errors='replace')
    elif extension in {'docx','pptx','xlsx'}: text = read_office_document(file_path, extension)
    else: raise ValueError(f'File type .{extension} not supported.')
    check_budget()
    text = clean_text(text)
    metadata = extract_document_metadata(text)
    current = _state.get()
    if current and 'receivedFrom' in current.review_fields:
        metadata['receivedFromNeedsReview'] = True
        metadata['senderConfidence'] = 'low'
        metadata['needsReview'] = list(dict.fromkeys(metadata['needsReview']+['receivedFrom']))
        metadata['senderReviewReasons'].append('Confirm the name because part of the scan had low OCR confidence.')
    if not text.strip():
        warn('No readable text was found. Upload a clearer scan or enter the fields manually.')
        raise ValueError('No readable text was found. Upload a clearer scan or enter the fields manually.')
    return {'text': text, 'metadata': metadata, 'warnings': list(current.warnings) if current else [], 'pages': text.count('\f')+1}


# =========================================================================
# FLASK SERVER & API ROUTES
# =========================================================================

try:
    from flask import Flask, request, jsonify
    from flask_cors import CORS
except ImportError:
    Flask = request = jsonify = CORS = None

app = Flask(__name__) if Flask else None
if app is not None:
    app.config['MAX_CONTENT_LENGTH'] = MAX_BYTES + 1024 * 1024
    CORS(app, resources={r'/*': {'origins': os.getenv('OCR_ALLOWED_ORIGIN', '*')}})

    @app.route('/health', methods=['GET'])
    def health():
        with _reads_lock:
            active_reads = len(_active_reads)
        return jsonify({
            'ok': True, 'success': True, 'service': 'PGENRO Intelligent Letter OCR & Classifier',
            'version': OCR_PARSER_VERSION, 'fullDocument': True, 'documentTimeoutSeconds': OCR_DOCUMENT_TIMEOUT,
            'adaptive': True, 'ocrLanguages': OCR_LANG.split('+'), 'activeReads': active_reads,
            'tesseractAvailable': bool(shutil.which(TESSERACT_CMD) or Path(TESSERACT_CMD).is_file())
        }), 200

    @app.errorhandler(413)
    def too_large(error):
        return jsonify(success=False, error='The file exceeds the 50 MB upload limit.'), 413

    @app.route('/ocr/status/<request_id>', methods=['GET'])
    def status(request_id):
        with _reads_lock:
            state = _active_reads.get(request_id)
            recent = _recent_reads.get(request_id)
        if state: return jsonify(success=True, requestId=request_id, **state.snapshot())
        if recent: return jsonify(success=True, requestId=request_id, **recent)
        return jsonify(success=False, error='Read not found.'), 404

    @app.route('/ocr', methods=['POST'])
    def run_ocr():
        uploaded_file = request.files.get('file')
        if not uploaded_file or not uploaded_file.filename:
            return jsonify(success=False, error='No file received.'), 400
        filename = Path(uploaded_file.filename.replace('\\', '/')).name
        ext = Path(filename).suffix.lower().lstrip('.')
        if ext not in ALLOWED_EXTENSIONS:
            return jsonify(success=False, error=f'Unsupported file type .{ext}'), 415
        request_id = request.headers.get('X-OCR-Request-ID') or uuid.uuid4().hex
        if not re.fullmatch(r'[A-Za-z0-9_-]{8,128}', request_id):
            return jsonify(success=False, error='Invalid OCR request identifier.'), 400
        state = ReadState()
        with _reads_lock:
            if request_id in _active_reads:
                return jsonify(success=False, error='That document is already being read.'), 409
            if len(_active_reads) >= OCR_MAX_ACTIVE:
                return jsonify(success=False, error='The document reader is busy. Retry shortly.'), 429
            cancelled_at = _cancelled_reads.pop(request_id, None)
            if cancelled_at and time.monotonic()-cancelled_at < 60: state.cancelled.set()
            _active_reads[request_id] = state
        token = _state.set(state)
        acquired = False
        try:
            reading_progress(stage='Waiting for the document reader')
            while not _document_slots.acquire(timeout=min(.2, check_budget())): check_budget()
            acquired = True
            with tempfile.TemporaryDirectory(prefix='PGENRO_OCR_') as tmp_dir:
                tmp_path = Path(tmp_dir) / f'doc.{ext}'
                uploaded_file.save(tmp_path)
                uploaded_size = tmp_path.stat().st_size
                if uploaded_size > MAX_BYTES:
                    return jsonify(success=False, error='The file exceeds 50 MB.'), 413
                if uploaded_size == 0:
                    return jsonify(success=False, error='The uploaded file is empty.'), 422
                check_budget()
                digest = hashlib.sha256(tmp_path.read_bytes()).hexdigest()
                key = f'{OCR_PARSER_VERSION}:{OCR_LANG}:{ext}:{digest}'
                result = cached_result(key)
                hit = result is not None
                if result is None:
                    result = read_document(tmp_path, ext)
                    cache_result(key, result)
            check_budget()
            reading_progress(stage='Complete')
            duration_ms = round((time.monotonic() - state.started) * 1000)
            reading_stats = state.snapshot()
            reading_stats['ocrPasses'] = state.passes
            reading_stats['cacheHit'] = hit
            return jsonify({
                'success': True, 'filename': filename, 'requestId': request_id,
                'characters': len(result['text']), 'durationMs': duration_ms, 'processingMs': duration_ms,
                'parserVersion': OCR_PARSER_VERSION, 'cacheHit': hit, 'readingStats': reading_stats, **result,
                **communication_form_payload(result['metadata'], result['text'], request.form.get('communicationType', 'Incoming'))
            }), 200
        except ReadCancelled as error:
            reading_progress(stage='Stopped')
            return jsonify(success=False, error=str(error), requestId=request_id), 409
        except (DocumentTimeout, subprocess.TimeoutExpired) as error:
            reading_progress(stage='Time limit reached')
            return jsonify(success=False, error='Reading reached the time limit. Use a smaller document or increase the OCR timeout.', requestId=request_id), 408
        except ValueError as error:
            reading_progress(stage='Document could not be read')
            message = str(error)
            status_code = 400 if 'password protected' in message.casefold() else 422
            return jsonify(success=False, error=message, requestId=request_id), status_code
        except (fitz.FileDataError, fitz.EmptyFileError, zipfile.BadZipFile, ET.ParseError, UnidentifiedImageError) as error:
            reading_progress(stage='Document could not be read')
            message = 'The uploaded file is invalid or unreadable.'
            return jsonify(success=False, error=message, requestId=request_id), 400
        except Exception as error:
            reading_progress(stage='Reading failed')
            return jsonify(success=False, error=str(error), requestId=request_id), 500
        finally:
            if acquired: _document_slots.release()
            with _reads_lock:
                _active_reads.pop(request_id, None)
                _recent_reads[request_id] = state.snapshot()
                while len(_recent_reads) > 100: _recent_reads.popitem(last=False)
            _state.reset(token)

    @app.route('/cancel', methods=['POST'])
    def cancel():
        payload = request.get_json(silent=True) or {}
        request_id = payload.get('requestId','')
        if not isinstance(request_id,str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,128}', request_id):
            return jsonify(success=False, error='Invalid OCR request identifier.'), 400
        with _reads_lock:
            state = _active_reads.get(request_id)
            if state: state.cancelled.set()
            elif request_id not in _recent_reads:
                _cancelled_reads[request_id] = time.monotonic()
                while len(_cancelled_reads) > 100: _cancelled_reads.popitem(last=False)
        return jsonify(success=True, requestId=request_id, cancelled=bool(state)), 200


def main():
    if not app: raise SystemExit('Install dependencies: pip install Flask flask-cors PyMuPDF Pillow')
    host = os.getenv('OCR_HOST', '127.0.0.1')
    port = int(os.getenv('OCR_PORT', '5000'))
    print(f'[PGENRO OCR SERVICE READY] http://{host}:{port}/ocr', flush=True)
    app.run(host=host, port=port, debug=False, threaded=True)

if __name__ == '__main__':
    main()