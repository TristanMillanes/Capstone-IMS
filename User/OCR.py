from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.utils import secure_filename

from pathlib import Path
import os
import shutil
import tempfile
import re
import statistics
from difflib import SequenceMatcher

import fitz
import pytesseract

from PIL import (
    Image,
    ImageOps,
    ImageEnhance,
    ImageFilter
)

# OpenCV is used only for stronger numeric / handwritten-digit preprocessing.
try:
    import cv2
    import numpy as np
    OPENCV_AVAILABLE = True
except Exception:
    cv2 = None
    np = None
    OPENCV_AVAILABLE = False


app = Flask(__name__)

CORS(
    app,
    resources={r"/*": {"origins": "*"}}
)

app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024

UPLOAD_FOLDER = (
    Path(tempfile.gettempdir())
    / "PGENRO_OCR_UPLOADS"
)

UPLOAD_FOLDER.mkdir(
    parents=True,
    exist_ok=True
)


# ============================================================
# TESSERACT LOCATION
# ============================================================

def locate_tesseract():

    env_path = os.getenv("TESSERACT_CMD")

    if env_path and Path(env_path).is_file():
        return env_path

    which_path = shutil.which("tesseract")

    if which_path:
        return which_path

    windows_paths = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        r"C:\Tesseract-OCR\tesseract.exe",
    ]

    for path in windows_paths:
        if os.path.isfile(path):
            return path

    return "tesseract"


pytesseract.pytesseract.tesseract_cmd = locate_tesseract()


# ============================================================
# CONFIG
# ============================================================

OCR_LANG = os.getenv(
    "OCR_LANG",
    "eng"
)

ALLOWED_EXTENSIONS = {
    "pdf",
    "png",
    "jpg",
    "jpeg",
    "webp",
    "bmp",
    "tif",
    "tiff",
    "docx",
    "txt",
    "csv",
    "xlsx",
    "pptx"
}

# Characters Tesseract is allowed to read in the numeric pass.
NUMERIC_WHITELIST = "0123456789-/.#:,()"


# ============================================================
# TEXT CLEANING
# ============================================================

def clean_text(text):

    if not text:
        return ""

    text = str(text)

    text = (
        text
        .replace("\r\n", "\n")
        .replace("\r", "\n")
        .replace("\u00A0", " ")
    )

    text = re.sub(
        r"[ \t]+",
        " ",
        text
    )

    text = re.sub(
        r"\n{3,}",
        "\n\n",
        text
    )

    # Preserve paragraphs and page boundaries; they delimit header fields.
    return "\n".join(line.strip(" \t") for line in text.split("\n")).strip()


# ============================================================
# IMAGE PREPROCESSING — NORMAL TEXT
# ============================================================

def preprocess_image_for_ocr(img):

    try:
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass

    img = img.convert("RGB")

    width, height = img.size

    if width < 1800:

        scale = 1800 / float(width)

        img = img.resize(
            (
                int(width * scale),
                int(height * scale)
            ),
            Image.Resampling.LANCZOS
        )

    gray = ImageOps.grayscale(img)

    gray = ImageOps.autocontrast(
        gray,
        cutoff=1
    )

    enhanced = ImageEnhance.Contrast(
        gray
    ).enhance(1.5)

    enhanced = ImageEnhance.Sharpness(
        enhanced
    ).enhance(1.5)

    return enhanced.filter(
        ImageFilter.SHARPEN
    )


# ============================================================
# IMAGE PREPROCESSING — NUMBERS / HANDWRITTEN DIGITS
# ============================================================

def numeric_preprocessing_variants(img):
    """
    Produces several high-contrast versions intended for digits,
    control numbers, dates, years, counts, and clearly written
    numeric marks.

    This improves detection of clear handwritten digits, but
    Tesseract is still not a dedicated handwriting-recognition model.
    """

    base = preprocess_image_for_ocr(img)
    variants = [base]

    if not OPENCV_AVAILABLE:
        # PIL-only fallback.
        for threshold in (140, 170, 200):
            binary = base.point(
                lambda p, t=threshold: 255 if p > t else 0
            )
            variants.append(binary)
        return variants

    arr = np.array(base)

    # Otsu threshold.
    _, otsu = cv2.threshold(
        arr,
        0,
        255,
        cv2.THRESH_BINARY + cv2.THRESH_OTSU
    )

    # Adaptive threshold helps when the handwriting / print is
    # unevenly lit or the scan has shadows.
    adaptive = cv2.adaptiveThreshold(
        arr,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        11
    )

    # Mild morphology closes small breaks in digit strokes.
    kernel = np.ones((2, 2), np.uint8)

    closed = cv2.morphologyEx(
        adaptive,
        cv2.MORPH_CLOSE,
        kernel,
        iterations=1
    )

    variants.extend([
        Image.fromarray(otsu),
        Image.fromarray(adaptive),
        Image.fromarray(closed),
    ])

    return variants


# ============================================================
# OCR
# ============================================================

def run_tesseract(image, psm):

    try:

        return pytesseract.image_to_string(
            image,
            lang=OCR_LANG,
            config=f"--oem 3 --psm {psm} -c preserve_interword_spaces=1"
        )

    except Exception:

        return ""


def score_ocr_text(text):

    if not text:
        return 0

    score = len(text)

    important_markers = [
        "SUBJECT",
        "DATE",
        "TO:",
        "OFFICE",
        "ORDER",
        "MEMORANDUM",
        "PROVINCIAL GOVERNMENT",
        "ENVIRONMENT AND NATURAL RESOURCES"
    ]

    upper_text = text.upper()

    for marker in important_markers:
        if marker in upper_text:
            score += 500

    # Prefer candidates that contain numeric characters as well.
    # This helps preserve control numbers / dates when comparing
    # OCR layouts.
    if re.search(r"\d", text):
        score += 100

    fields = parse_header_fields(text)
    if fields["subject"]:
        score += 1200
    if fields["controlNo"]:
        score += 1200
    return score


def fast_ocr_image(image, header_metadata=None):

    processed = preprocess_image_for_ocr(
        image
    )

    candidates = []

    # Normal document layout.
    text_psm3 = run_tesseract(
        processed,
        3
    )

    if text_psm3:
        candidates.append(
            clean_text(text_psm3)
        )

    # Block layout.
    text_psm6 = run_tesseract(
        processed,
        6
    )

    if text_psm6:
        candidates.append(
            clean_text(text_psm6)
        )

    # Sparse document / letterhead.
    text_psm11 = run_tesseract(
        processed,
        11
    )

    if text_psm11:
        candidates.append(
            clean_text(text_psm11)
        )

    candidates = [
        text for text in candidates
        if text
    ]

    # Keep subject detection from all OCR layouts, not just the longest page text.
    if header_metadata is not None:
        recovered = select_subject_candidate(candidates)
        if not recovered:
            # Retry the header with its larger text blocks isolated from the body.
            header_crop = processed.crop((0, 0, processed.width, int(processed.height * 0.70)))
            header_text = clean_text(run_tesseract(header_crop, 6))
            if header_text:
                # Keep full-page OCR text; the crop supplies metadata only.
                if not candidates:
                    candidates.append(header_text)
                recovered = select_subject_candidate([header_text])
        if recovered:
            header_metadata.update(recovered)
    if not candidates:
        return ""
    return max(candidates, key=score_ocr_text)


def select_subject_candidate(candidates):
    parsed = [(candidate, parse_header_fields(candidate)) for candidate in candidates]
    found = [(candidate, fields) for candidate, fields in parsed if fields["subject"]]
    if not found:
        return {}
    def rank(item):
        text, fields = item
        key = fields["subject"].casefold()
        agreement = sum(other["subject"].casefold() == key for _, other in found)
        return agreement, score_ocr_text(text)
    _, chosen = max(found, key=rank)
    return {"subject": chosen["subject"], "subjectEvidence": chosen["fieldEvidence"]["subject"]}


# ============================================================
# NUMERIC / DIGIT OCR
# ============================================================

def extract_numeric_tokens(text):
    """
    Keep actual numeric-looking tokens instead of arbitrary text.
    Examples:
      25-002
      2026
      09/23/2026
      113
      #12
      1,250
    """

    if not text:
        return []

    # Reject isolated punctuation and require at least one digit.
    raw_tokens = re.findall(
        r"(?<![A-Za-z])(?:#\s*)?\d[\d,./()#:\-]*(?![A-Za-z])",
        text
    )

    cleaned = []

    for token in raw_tokens:
        token = re.sub(r"\s+", "", token)
        token = token.strip(".,;:")

        if not re.search(r"\d", token):
            continue

        # Avoid returning a single punctuation-only artifact.
        if not re.search(r"\d", token):
            continue

        if token not in cleaned:
            cleaned.append(token)

    return cleaned


def numeric_ocr_image(image):
    """
    Dedicated numeric pass.

    Runs multiple thresholding variants and Tesseract numeric
    whitelisting. This is particularly useful for:
      - control numbers
      - dates
      - years
      - numbered sections
      - counts
      - clearly written / handwritten digits

    Returns both a readable numeric string and detected tokens.
    """

    all_candidates = []

    for variant in numeric_preprocessing_variants(image):

        for psm in (6, 11, 12):

            try:
                data = pytesseract.image_to_data(
                    variant,
                    lang=OCR_LANG,
                    config=(
                        f"--oem 3 --psm {psm} "
                        f"-c tessedit_char_whitelist={NUMERIC_WHITELIST} "
                        f"-c preserve_interword_spaces=1"
                    ),
                    output_type=pytesseract.Output.DICT
                )
            except Exception:
                continue

            tokens = []

            n = len(data.get("text", []))

            for i in range(n):
                token = str(data["text"][i] or "").strip()
                if not token:
                    continue

                confidence = float(data["conf"][i] or -1)

                if confidence < 0:
                    continue

                cleaned = token.replace(" ", "")

                if not re.search(r"\d", cleaned):
                    continue

                # Normalize common OCR confusion in numeric-only pass.
                cleaned = (
                    cleaned
                    .replace("O", "0")
                    .replace("o", "0")
                    .replace("I", "1")
                    .replace("l", "1")
                    .replace("|", "1")
                    .replace("S", "5")
                    .replace("s", "5")
                    .replace("B", "8")
                )

                tokens.append(
                    (cleaned, confidence)
                )

            if tokens:
                all_candidates.append(tokens)

    if not all_candidates:
        return {
            "text": "",
            "tokens": [],
            "confidence": 0
        }

    flattened = [
        item
        for candidate in all_candidates
        for item in candidate
    ]

    # Group by token and keep the strongest confidence.
    best_by_token = {}

    for token, confidence in flattened:
        if token not in best_by_token:
            best_by_token[token] = confidence
        else:
            best_by_token[token] = max(
                best_by_token[token],
                confidence
            )

    ranked = sorted(
        best_by_token.items(),
        key=lambda pair: pair[1],
        reverse=True
    )

    tokens = [
        token
        for token, confidence in ranked
        if token
    ]

    confidence_values = [
        confidence
        for _, confidence in ranked
        if confidence >= 0
    ]

    average_confidence = (
        statistics.mean(confidence_values)
        if confidence_values
        else 0
    )

    return {
        "text": " ".join(tokens),
        "tokens": tokens,
        "confidence": round(
            float(average_confidence),
            2
        )
    }


# ============================================================
# SIGNATORY RECOVERY
# ============================================================

def extract_signatory_text(text):
    """Return the signer and role when the document actually identifies one."""
    lines = [line.strip() for line in str(text or "").splitlines() if line.strip()]
    found = ""
    for i, original in enumerate(lines):
        line = re.sub(r"[ \t]+", " ", original).strip(" |;:-")
        if len(line) < 8 or len(line) > 105:
            continue
        line = re.sub(r"^(EnP|Engr|Atty|Dr|Hon|Mr|Ms|Mrs)\s*['.:-]?\s*", r"\1 ", line, flags=re.I)
        titled = bool(re.match(r"^(?:EnP|Engr|Atty|Dr|Hon|Mr|Ms|Mrs)\.?\s+", line, re.I))
        words = re.findall(r"[A-Za-z][A-Za-z.'-]*", line)
        if len(words) < 3 or len(words) > 10:
            continue
        if re.search(r"\b(?:REPUBLIC|PROVINCE|GOVERNMENT|OFFICE|ORDER|SUBJECT|PERSONNEL|DIVISION|DEPARTMENT|SCHEDULE|TRAVEL|COMPLIANCE)\b", line, re.I):
            continue
        role = lines[i + 1].strip(" |;:-.") if i + 1 < len(lines) else ""
        has_role = bool(re.search(
            r"\b(?:PGDH|PGENRO|PG\s*ENRO|OFFICER|DIRECTOR|CHIEF|MAYOR|ADMINISTRATOR|SUPERVISOR|MANAGER|SECRETARY|DEPARTMENT\s+HEAD|DIVISION\s+HEAD)\b",
            role, re.I
        ))
        closing = any(re.search(r"\b(?:SINCERELY|RESPECTFULLY|TRULY|COMPLIANCE|VERY\s+TRULY|YOURS)\b", prev, re.I)
                      for prev in lines[max(0, i - 4):i])
        if not (titled and has_role or has_role and line == line.upper() or titled and closing or closing and line == line.upper()):
            continue
        role = re.sub(r"\bPGDH\s+PG[:. -]*ENRO[A-Z]?\b.*", "PGDH PG ENRO", role, flags=re.I)
        role = re.sub(r"[ \t]+", " ", role).strip(" |;:-.") if has_role else ""
        found = f"{line} — {role}" if role else line
    return found


def recover_scanned_signatory(image):
    """Remove blue pen strokes around a printed signature and OCR that region."""
    try:
        rgb = image.convert("RGB")
        if rgb.width > 1400:
            rgb = rgb.resize((1400, round(rgb.height * 1400 / rgb.width)), Image.Resampling.LANCZOS)
        width, height = rgb.size
        pixels = rgb.load()
        blue_rows = []
        for y in range(int(height * .22), int(height * .92)):
            count, left, right = 0, width, 0
            for x in range(width):
                r, g, b = pixels[x, y]
                if b > r * 1.25 and b > g * 1.18 and b - r > 12 and min(r, g, b) < 220:
                    count += 1
                    left, right = min(left, x), max(right, x)
            if count > 2:
                blue_rows.append((y, count, left, right))
        if not blue_rows:
            return ""
        bands = []
        for row in blue_rows:
            if not bands or row[0] - bands[-1][-1][0] > max(12, int(height * .013)):
                bands.append([row])
            else:
                bands[-1].append(row)
        band = max(bands, key=lambda rows: sum(row[1] for row in rows))
        if sum(row[1] for row in band) < max(150, width * .12):
            return ""
        box = (
            max(0, min(row[2] for row in band) - int(width * .08)),
            max(0, band[0][0] - int(height * .015)),
            min(width, max(row[3] for row in band) + int(width * .13)),
            min(height, band[-1][0] + int(height * .045))
        )
        crop = rgb.crop(box)
        mask = Image.new("L", crop.size)
        cleaned = []
        for r, g, b in crop.getdata():
            blue = b > r * 1.25 and b > g * 1.18 and b - r > 12
            cleaned.append(255 if blue or min(r, g, b) > 180 else 0)
        mask.putdata(cleaned)
        scale = 3 if crop.width <= 900 else 2
        mask = mask.resize((crop.width * scale, crop.height * scale), Image.Resampling.LANCZOS)
        recognized = pytesseract.image_to_string(mask, lang=OCR_LANG, config="--psm 6")
        return clean_text(recognized) if extract_signatory_text(recognized) else ""
    except Exception as error:
        app.logger.warning("Signature OCR skipped: %s", error)
        return ""


# ============================================================
# PDF OCR
# ============================================================

def extract_pdf(file_path, header_metadata=None):

    output = []

    with fitz.open(file_path) as document:

        for page_index, page in enumerate(
            document,
            start=1
        ):

            embedded = clean_text(
                page.get_text("text", sort=True) or ""
            )

            # If PDF already contains selectable text.
            first_page_needs_subject = (page_index == 1 and header_metadata is not None
                                        and not parse_header_fields(embedded)["subject"])
            if len(embedded) >= 40 and not first_page_needs_subject:
                output.append(embedded)
                continue

            # High-resolution scan.
            pixmap = page.get_pixmap(
                matrix=fitz.Matrix(
                    3.5,
                    3.5
                ),
                alpha=False
            )

            image = Image.frombytes(
                "RGB",
                (
                    pixmap.width,
                    pixmap.height
                ),
                pixmap.samples
            )

            scanned_text = fast_ocr_image(
                image, header_metadata if page_index == 1 else None
            )
            recovered = recover_scanned_signatory(image)
            if recovered:
                scanned_text += "\n" + recovered

            # Preserve native PDF text when only its subject required image OCR.
            output.append(embedded if len(embedded) >= 40 else scanned_text)

    return "\n\f\n".join(output)


def extract_pdf_numeric(file_path):
    """
    Separate numeric OCR pass for scanned PDF pages.

    For text-native PDFs, PDF text extraction is already reliable,
    so numeric OCR is only necessary on scanned/image pages.
    """

    all_tokens = []
    all_numeric_text = []
    confidences = []

    with fitz.open(file_path) as document:

        for page_index, page in enumerate(
            document,
            start=1
        ):

            embedded = clean_text(
                page.get_text("text", sort=True) or ""
            )

            if len(embedded) >= 40:
                tokens = extract_numeric_tokens(
                    embedded
                )
                all_tokens.extend(tokens)
                continue

            pixmap = page.get_pixmap(
                matrix=fitz.Matrix(
                    3.5,
                    3.5
                ),
                alpha=False
            )

            image = Image.frombytes(
                "RGB",
                (
                    pixmap.width,
                    pixmap.height
                ),
                pixmap.samples
            )

            numeric_result = numeric_ocr_image(
                image
            )

            if numeric_result["text"]:
                all_numeric_text.append(
                    numeric_result["text"]
                )

            all_tokens.extend(
                numeric_result["tokens"]
            )

            confidences.append(
                numeric_result["confidence"]
            )

    unique_tokens = []

    for token in all_tokens:
        if token not in unique_tokens:
            unique_tokens.append(token)

    return {
        "text": " ".join(all_numeric_text),
        "tokens": unique_tokens,
        "confidence": round(
            statistics.mean(confidences),
            2
        ) if confidences else 0
    }


# ============================================================
# SIMPLE METADATA EXTRACTION
# ============================================================

# Header fields deliberately do not use the unlocated, digits-only OCR pass.
SUBJECT_LABEL = r"(?:S\\s*U\\s*B\\s*[JJI1]\\s*E\\s*C\\s*T(?:\\s+MATTER)?|SUBJ\\.?|SUBJECI|SUB3ECT|SUBJECT)"

SUBJECT_RE = re.compile(
    r"^[|!•>\\[\\]\\s]*(?:" +
    SUBJECT_LABEL +
    r"(?:\\s*[:;：；.\\-–—=|]+\\s*|\\s+|$)|RE\\s*[:;：]\\s*)(.*)$",
    re.I
)
CONTROL_LABEL = r"(?:(?:DOCUMENT\s+)?(?:CONTROL|TRACKING|REFERENCE|REF\.?|DOCUMENT|DOC\.?)\s*(?:NO\.?|NUMBER|#)|(?:OFFICE\s+MEMORANDUM|MEMORANDUM|MEMO|OFFICE\s+ORDER|SPECIAL\s+ORDER|TRAVEL\s+ORDER|ADMINISTRATIVE\s+ORDER|CIRCULAR|RESOLUTION)\s*(?:NO\.?|NUMBER|#)|NO\.?|NUMBER)"
CONTROL_RE = re.compile(r"^" + CONTROL_LABEL + r"(?=\s|[:#.=\-]|$)\s*[:#.=\-]?\s*(.*)$", re.I)
FIELD_RE = re.compile(r"^(?:DATE(?:\s+(?:RECEIVED|RELEASED|ISSUED))?|DATED|FROM|TO|T0|FOR|THRU|THROUGH|CC|ATTACHMENTS?|ENCLOSURES?|REF(?:ERENCE)?|STATUS|REMARKS)\s*(?:[:;\-]|$)", re.I)
BODY_RE = re.compile(r"^(?:DEAR|GREETINGS|SIR|MADAM|MA'AM|TO\s+WHOM|PLEASE|KINDLY|THIS\s+(?:IS|HAS|WILL|REFERS)|WE\s+(?:ARE|WILL|WOULD|REQUEST)|I\s+(?:AM|WOULD)|YOU\s+ARE|THE\s+UNDERSIGNED|IN\s+(?:LIGHT\s+OF|CONNECTION\s+WITH)|PURSUANT\s+TO|FOR\s+YOUR\s+(?:INFORMATION|COMPLIANCE)|SINCERELY|RESPECTFULLY)\b", re.I)
SERIES_RE = re.compile(r"^(?:,\s*)?(?:S\.?|SERIES\s+OF)\s*[,.:]?\s*(?:19|20)\d{2}\.?$", re.I)


def normalize_control_number(value):
    value = re.sub(r"[\u2010-\u2015\u2212]", "-", str(value or ""))
    value = re.sub(r"\s*([/._-])\s*", r"\1", value)
    value = re.sub(r"\b(s\.)\s*(?=\d{4}\b)", r"\1 ", value, flags=re.I)
    return re.sub(r"\s+", " ", value).strip().rstrip(".;")


def control_number_key(value):
    # Keep meaningful punctuation and leading zeroes. Only presentation differs.
    return re.sub(r"\s+", "", normalize_control_number(value)).upper()


def normalize_header_layout(text):
    text = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("：", ":").replace("；", ";").replace("\u200b", "")
    output = []
    for line in text.split("\n"):
        # OCR can merge separate header cells into one physical text row.
        if re.match(r"^[|!•>\[\]\s]*(?:TO|T0|FROM|DATE|THRU|FOR|SUBJECT|SUBJ|RE|CONTROL|MEMORANDUM)\b", line, re.I):
            line = re.sub(r"[ \t|]+(?=(?:" + SUBJECT_LABEL + r"|DATE(?:\s+(?:ISSUED|RECEIVED|RELEASED))?|FROM|TO|THRU|CONTROL\s+(?:NO\.?|NUMBER))\s*[:;：])", "\n", line, flags=re.I)
        output.append(line)
    return "\n".join(output)



def is_subject_label(text):
    """Detect SUBJECT even when OCR misreads letters."""
    clean = re.sub(r"[^A-Z0-9]", "", str(text).upper())

    if not clean:
        return False

    similarity = SequenceMatcher(
        None,
        clean,
        "SUBJECT"
    ).ratio()

    return similarity >= 0.65


def recover_subject_from_lines(lines):
    """
    Fallback subject detection for scanned documents,
    blurred prints, and handwritten headers.
    """
    for index, line in enumerate(lines):

        if is_subject_label(line):

            value = re.sub(
                r"^(SUBJECT|SUBJECI|SUBJ|SUB3ECT)\s*[:;\-：]?\s*",
                "",
                line,
                flags=re.I
            ).strip()

            if value:
                return value

            if index + 1 < len(lines):
                return lines[index + 1].strip()

    return ""


def parse_header_fields(text):
    lines = [re.sub(r"[ \t\u00a0]+", " ", line).strip()
             for line in normalize_header_layout(text).split("\f", 1)[0].split("\n")]
    subject = ""
    subject_source = ""
    candidates = []

    i = seen = 0
    while i < len(lines) and seen < 60:
        line = lines[i]
        if not line:
            i += 1
            continue
        seen += 1
        if BODY_RE.match(line):
            break
        match = SUBJECT_RE.match(line)
        if match:
            inline = re.sub(r"^[|:;：\s]+", "", match.group(1)).strip()
            parts = [inline] if inline else []
            start = i
            i += 1
            gaps = 0
            while i < len(lines):
                following = lines[i]
                if not following:
                    # Sparse OCR inserts blank rows between wrapped header lines.
                    # Cross a gap only with a clear grammatical continuation.
                    probe = i + 1
                    while probe < len(lines) and not lines[probe]:
                        probe += 1
                    if (parts and probe < len(lines) and probe - i <= 2
                            and not BODY_RE.match(lines[probe])
                            and not FIELD_RE.match(lines[probe])
                            and not CONTROL_RE.match(lines[probe])
                            and not SUBJECT_RE.match(lines[probe])
                            and not re.search(r"[.!?]$", parts[-1])
                            and (re.match(r"^(?:FOR|OF|ON|AND|OR|WITH|REGARDING|DURING)\b", lines[probe], re.I)
                                 or re.search(r"\b(?:FOR|OF|ON|AND|OR|WITH|REGARDING|DURING)$", parts[-1], re.I))):
                        i = probe
                        continue
                    if parts or gaps >= 2:
                        break
                    gaps += 1
                    i += 1
                    continue
                # Some PDF layouts place ':' on its own line after SUBJECT.
                if not parts and re.fullmatch(r"[:;：|\-]+", following):
                    i += 1
                    continue
                if (FIELD_RE.match(following) or CONTROL_RE.match(following)
                        or SUBJECT_RE.match(following) or BODY_RE.match(following)
                        or re.match(r"^(?:\d+[.)]\s|[•*]\s|[-_=]{3,}$)", following)):
                    break
                if parts and re.search(r"[.!?]$", parts[-1]):
                    break
                parts.append(following)
                i += 1
            if not subject:
                subject = re.sub(r"\s+", " ", " ".join(parts)).strip()
                subject_source = "\n".join(lines[start:i])
            # Once the subject ends, only labeled header fields may follow it.
            probe = i
            while probe < len(lines) and not lines[probe]:
                probe += 1
            if probe >= len(lines) or not (FIELD_RE.match(lines[probe]) or CONTROL_RE.match(lines[probe])):
                break
            i = probe
            continue
        control_match = CONTROL_RE.match(line)
        if control_match:
            raw = control_match.group(1).strip()
            consumed = i
            if not raw:
                probe = i + 1
                while probe < min(len(lines), i + 4) and not lines[probe]:
                    probe += 1
                if probe < len(lines):
                    raw = lines[probe]
                    consumed = probe
            value = normalize_control_number(raw)
            # Value is one identifier, optionally followed by its printed series.
            valid = re.fullmatch(r"[A-Z0-9]+(?:[._/-][A-Z0-9]+)*(?:,?\s*(?:S\.?|SERIES\s+OF)\s*[,.:]?\s*(?:19|20)\d{2})?", value, re.I)
            if valid and re.search(r"\d", value):
                probe = consumed + 1
                while probe < min(len(lines), consumed + 3) and not lines[probe]:
                    probe += 1
                if probe < len(lines) and SERIES_RE.fullmatch(lines[probe]) and not re.search(r"(?:S\.|SERIES\s+OF)", value, re.I):
                    value += ", " + lines[probe].lstrip(", ").rstrip(".")
                    consumed = probe
                # Explicit control labels take priority over a reference to another document.
                priority = 2 if re.match(r"^(?:REFERENCE|REF\.?)\b", line, re.I) else 1
                candidates.append({"value": value, "source": "\n".join(lines[i:consumed + 1]), "priority": priority})
                i = consumed
        i += 1
    # Fallback recovery for OCR mistakes such as SUBJECI / SUB3ECT.
    fallback_subject = recover_subject_from_lines(lines)
    if fallback_subject and not subject:
        subject = fallback_subject
        subject_source = fallback_subject

    best = []
    if candidates:
        priority = min(item["priority"] for item in candidates)
        for item in candidates:
            if item["priority"] == priority and control_number_key(item["value"]) not in {control_number_key(x["value"]) for x in best}:
                best.append(item)
    return {
        "subject": subject,
        "controlNo": best[0]["value"] if len(best) == 1 else "",
        "extractionVersion": "header-v2",
        "fieldEvidence": {"subject": subject_source, "controlNo": best[0]["source"] if len(best) == 1 else ""},
        "controlNoCandidates": [item["value"] for item in best],
        "needsReview": (["subject"] if not subject else []) + (["controlNo"] if len(best) != 1 else [])
    }


def extract_document_metadata(
    text,
    numeric_text="",
    numeric_tokens=None
):
    """
    Extract structured fields shared by Communication and Office
    Memorandum OCR.

    Control numbers and subjects come from labeled first-page header fields.
    Unlocated numeric recovery remains diagnostic only for control numbers.
    """

    result = {
        "sourceOffice": "",
        "recipient": "",
        "subject": "",
        "controlNo": "",
        "documentType": "",
        "date": "",
        "issuedBy": "",
        "signatory": "",
        "detectedNumbers": numeric_tokens or []
    }

    header_fields = parse_header_fields(text)
    text = clean_text(text)

    numeric_text = clean_text(
        numeric_text
    )

    lines = [
        line.strip()
        for line in text.splitlines()
        if line.strip()
    ]

    # Office and addressee metadata must come from the document header.
    # Retain a salutation for letters that address the recipient without TO.
    header_lines = lines[:40]
    for header_end, header_line in enumerate(header_lines):
        if re.match(r"^(?:SUBJECT(?:\s+MATTER)?|SUBJ|RE)\s*[:;.-]", header_line, re.I):
            header_lines = header_lines[:header_end]
            break
        if re.match(r"^(?:DEAR|GREETINGS|SIR|MADAM|MA'AM|TO WHOM IT MAY CONCERN)\b", header_line, re.I):
            header_lines = header_lines[:header_end + 1]
            break
        if re.match(r"^(?:SINCERELY|RESPECTFULLY)\b", header_line, re.I):
            header_lines = header_lines[:header_end]
            break

    upper = text.upper()

    def clean_field(value):
        return re.sub(
            r"\s+",
            " ",
            str(value or "")
        ).strip(" \t:;,.|-")

    def parse_date_value(value):

        value = str(value or "").strip()

        m = re.search(
            r"\b(\d{1,2})\s+"
            r"(January|February|March|April|May|June|July|August|September|October|November|December)"
            r"\s+(\d{4})\b",
            value,
            re.I
        )

        if m:
            return value.strip()

        m = re.search(
            r"\b(January|February|March|April|May|June|July|August|September|October|November|December)"
            r"\s+(\d{1,2}),?\s+(\d{4})\b",
            value,
            re.I
        )

        if m:
            return value.strip()

        m = re.search(
            r"\b\d{4}-\d{1,2}-\d{1,2}\b",
            value
        )

        if m:
            return m.group(0)

        return ""

    def extract_labeled(
        labels,
        max_follow=2
    ):

        pattern = re.compile(
            r"^(?:" +
            "|".join(labels) +
            r")\s*[:;\-]\s*(.*)$",
            re.I
        )

        for i, line in enumerate(lines):

            match = pattern.match(line)

            if not match:
                continue

            collected = []

            if match.group(1):
                collected.append(
                    match.group(1).strip()
                )

            for next_line in lines[
                i + 1:
                i + 1 + max_follow
            ]:

                if re.match(
                    r"^(?:DATE|TO|T0|FROM|THRU|REF|SUBJECT|SUBJ|RE)\s*[:;\-]",
                    next_line,
                    re.I
                ):
                    break

                if re.match(
                    r"^(?:DEAR|GREETINGS|SIR|MADAM|\d+\.)\b",
                    next_line,
                    re.I
                ):
                    break

                collected.append(
                    next_line
                )

            value = clean_field(
                " ".join(collected)
            )

            if value:
                return value

        return ""

    # --------------------------------------------------------
    # SOURCE / ORIGINATING OFFICE
    # --------------------------------------------------------

    header = header_lines[:25]

    source_lines = []

    for line in header:

        if re.search(
            r"^(?:TO|T0|SUBJECT|SUBJ|DATE|FROM|REF|THRU)\b",
            line,
            re.I
        ):
            break

        if re.search(
            r"PROVINCIAL GOVERNMENT|CITY GOVERNMENT|MUNICIPAL GOVERNMENT|REGIONAL GOVERNMENT|DEPARTMENT OF",
            line,
            re.I
        ):
            source_lines.append(line)
            continue

        if re.search(
            r"\bOFFICE$",
            line,
            re.I
        ):
            source_lines.append(line)

    if source_lines:

        result["sourceOffice"] = clean_field(
            " ".join(source_lines)
        )

    # --------------------------------------------------------
    # CONTROL NUMBER
    # --------------------------------------------------------

    # Only explicit header labels supply a control number. A digits-only pass
    # has no position/label information and must never supply an identifier.
    result["controlNo"] = header_fields["controlNo"]

    # --------------------------------------------------------
    # DOCUMENT TYPE
    # --------------------------------------------------------

    if re.search(
        r"\bOFFICE\s+MEMORANDUM\b|\bOFFICE\s+MEMO\b",
        upper
    ):
        result["documentType"] = "Memorandum"

    elif re.search(
        r"\bSPECIAL\s+ORDER\b",
        upper
    ):
        result["documentType"] = "Special Order"

    elif re.search(
        r"\bOFFICE\s+ORDER\b",
        upper
    ):
        result["documentType"] = "Office Order"

    elif re.search(
        r"\bTRAVEL\s+ORDER\b",
        upper
    ):
        result["documentType"] = "Travel Order"

    elif re.search(
        r"\b(?:MEMORANDUM|MEMO)\b",
        upper
    ):
        result["documentType"] = "Memorandum"

    # --------------------------------------------------------
    # RECIPIENT
    # --------------------------------------------------------

    # The recipient comes from TO/FOR in the document header, not the signer.
    for i, line in enumerate(header_lines):
        match = re.match(
            r"^(?:TO|T0|MEMORANDUM\s+FOR|ADDRESSED\s+TO|ATTENTION|ATTN\.?|FOR)\s*[:;.-]\s*(.*)$",
            line,
            re.I
        )
        if not match:
            continue
        parts = [match.group(1).strip()] if match.group(1).strip() else []
        for following in header_lines[i + 1:i + 4]:
            if re.match(r"^(?:SUBJECT(?:\s+MATTER)?|SUBJ|RE|DATE|FROM|THRU|REF(?:ERENCE)?)\b\s*[:;.-]", following, re.I):
                break
            if re.match(r"^(?:DEAR|GREETINGS|SIR|MADAM|PLEASE|THIS|WE|I|IN\s+LIGHT\s+OF)\b", following, re.I):
                break
            if re.match(r"^(?:\d+\.|[•*-]\s+)", following) or len(following) > 100:
                break
            if len(" ".join(parts)) + len(following) > 170:
                break
            parts.append(following)
        result["recipient"] = clean_field(" ".join(parts))
        break

    if not result["recipient"]:
        header = header_lines
        salutation = next((i for i, line in enumerate(header)
            if re.match(r"^(?:DEAR|GREETINGS|SIR|MADAM|MA'AM|TO WHOM IT MAY CONCERN)\b", line, re.I)), -1)
        for line in reversed(header[max(0, salutation - 3):salutation]) if salutation > 0 else []:
            if re.match(r"^(?:DATE|FROM|REF|SUBJECT|REPUBLIC|PROVINCE OF|PROVINCIAL GOVERNMENT)\b", line, re.I):
                break
            if re.match(r"^(?:\d{1,2}\s+\w+\s+\d{4}|\w+\s+\d{1,2},?\s+\d{4}|\d{4}-\d{1,2}-\d{1,2})$", line, re.I):
                break
            if 3 <= len(line) <= 150:
                result["recipient"] = clean_field(line)
                break

    # An explicit FROM overrides the letterhead for received communications.
    for line in header_lines:
        match = re.match(r"^(?:FROM|SENDER|ISSUING\s+OFFICE|ORIGINATING\s+OFFICE)\s*[:;.-]\s*(.+)$", line, re.I)
        if match:
            result["sourceOffice"] = clean_field(match.group(1))
            break

    result["subject"] = header_fields["subject"]

    # --------------------------------------------------------
    # DATE
    # --------------------------------------------------------

    date_match = re.search(
        r"(?:^|\n)\s*(?:DATE|DATE\s+ISSUED|DATED)\s*[:;\-]?\s*([^\n\r]+)",
        text,
        re.I
    )

    if date_match:

        result["date"] = parse_date_value(
            date_match.group(1)
        )

    if not result["date"]:

        top_text = "\n".join(
            lines[:40]
        )

        result["date"] = parse_date_value(
            top_text
        )

    # Numeric ISO date fallback.
    if not result["date"]:

        numeric_date = re.search(
            r"\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b",
            numeric_text
        )

        if numeric_date:

            result["date"] = (
                f"{numeric_date.group(1)}-"
                f"{numeric_date.group(2).zfill(2)}-"
                f"{numeric_date.group(3).zfill(2)}"
            )

    # --------------------------------------------------------
    # ISSUED BY / FROM
    # --------------------------------------------------------

    result["issuedBy"] = extract_labeled(
        [
            "FROM",
            "ISSUED BY",
            "ISSUING OFFICE",
            "ORIGINATING OFFICE"
        ],
        2
    )

    if not result["issuedBy"]:
        result["issuedBy"] = (
            result["sourceOffice"]
        )

    result["signatory"] = extract_signatory_text(text)

    # Return evidence and review flags alongside the existing API fields.
    result.update(header_fields)

    return result


# ============================================================
# HEALTH
# ============================================================

@app.route("/health", methods=["GET"])
def health():

    return jsonify({
        "ok": True,
        "service": "PGENRO Enhanced OCR Server",
        "numeric_ocr": True,
        "opencv_numeric_preprocessing": OPENCV_AVAILABLE,
        "tesseract": (
            pytesseract
            .pytesseract
            .tesseract_cmd
        )
    }), 200


# ============================================================
# OCR ENDPOINT
# ============================================================

@app.route("/ocr", methods=["POST"])
def run_ocr():

    uploaded_file = request.files.get(
        "file"
    )

    if (
        not uploaded_file
        or not uploaded_file.filename
    ):

        return jsonify({
            "success": False,
            "error": "No file received."
        }), 400

    filename = secure_filename(
        uploaded_file.filename
    )

    extension = (
        filename.rsplit(".", 1)[-1].lower()
        if "." in filename
        else ""
    )

    if extension not in ALLOWED_EXTENSIONS:

        return jsonify({
            "success": False,
            "error":
                f"File type .{extension} not supported."
        }), 400

    temporary_path = None

    try:

        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=f".{extension}",
            dir=UPLOAD_FOLDER
        ) as tmp:

            uploaded_file.save(tmp)

            temporary_path = Path(
                tmp.name
            )

        header_metadata = {}
        numeric_result = {
            "text": "",
            "tokens": [],
            "confidence": 0
        }

        # ----------------------------------------------------
        # FILE EXTRACTION
        # ----------------------------------------------------

        if extension == "pdf":

            raw_text = extract_pdf(
                temporary_path, header_metadata
            )

            numeric_result = extract_pdf_numeric(
                temporary_path
            )

        elif extension in {
            "png",
            "jpg",
            "jpeg",
            "webp",
            "bmp",
            "tif",
            "tiff"
        }:

            with Image.open(
                temporary_path
            ) as image:

                raw_text = fast_ocr_image(
                    image, header_metadata
                )
                recovered = recover_scanned_signatory(image)
                if recovered:
                    raw_text += "\n" + recovered

                numeric_result = numeric_ocr_image(
                    image
                )

        elif extension in {
            "txt",
            "csv"
        }:

            with open(
                temporary_path,
                "r",
                encoding="utf-8",
                errors="ignore"
            ) as f:

                raw_text = f.read()

            numeric_result = {
                "text": "",
                "tokens": extract_numeric_tokens(
                    raw_text
                ),
                "confidence": 100
            }

        else:

            raw_text = ""

        clean_result = clean_text(
            raw_text
        )

        if not clean_result:

            # For a number-only scan, the numeric pass may still
            # have something useful even if ordinary OCR returns none.
            if not numeric_result["text"]:

                return jsonify({
                    "success": False,
                    "error":
                        "No text detected in document."
                }), 422

        metadata = extract_document_metadata(
            clean_result,
            numeric_text=numeric_result["text"],
            numeric_tokens=numeric_result["tokens"]
        )

        if header_metadata.get("subject"):
            metadata["subject"] = header_metadata["subject"]
            metadata["fieldEvidence"]["subject"] = header_metadata["subjectEvidence"]
            metadata["needsReview"] = [field for field in metadata["needsReview"] if field != "subject"]

        return jsonify({

            "success": True,

            "filename": filename,

            "characters": len(
                clean_result
            ),

            "text": clean_result,

            "numericText":
                numeric_result["text"],

            "detectedNumbers":
                numeric_result["tokens"],

            "numericConfidence":
                numeric_result["confidence"],

            "metadata":
                metadata

        }), 200

    except Exception as e:

        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

    finally:

        if (
            temporary_path
            and temporary_path.exists()
        ):

            try:

                temporary_path.unlink()

            except Exception:

                pass


# ============================================================
# START SERVER
# ============================================================

if __name__ == "__main__":

    print(
        "[PGENRO OCR SERVER] "
        "Running at http://127.0.0.1:5000 ..."
    )

    print(
        "[TESSERACT]",
        pytesseract
        .pytesseract
        .tesseract_cmd
    )

    print(
        "[NUMERIC OCR]",
        "ENABLED"
    )

    print(
        "[OPENCV NUMERIC PREPROCESSING]",
        OPENCV_AVAILABLE
    )

    app.run(
        host="127.0.0.1",
        port=5000,
        debug=False,
        threaded=True
    )
