"""Printed document headers and main-letter signatories; no invented values."""
import datetime
import re
import xml.etree.ElementTree as ET
from zipfile import ZipFile


def printed_signatory(raw_text=""):
    lines = []
    offset = 0
    for page, text in enumerate(str(raw_text or "").replace("\r", "").split("\f")):
        page_lines = text.split("\n")
        if page and any(re.match(r"^\s*(?:ANNEX|APPENDIX|ATTACHMENT|ENCLOSURE)\b|^\s*(?:(?:PG\s*ENRO|PGENRO)\s+)?(?:OFFICE\s+)?(?:MEMORANDUM|MEMO|REQUEST LETTER|OFFICE ORDER)\b", s, re.I) for s in [s for s in page_lines if s.strip()][:8]):
            break
        lines.extend((re.sub(r"[ \t]+", " ", s.replace("\u00a0", " ")).strip(), offset + i + 1) for i, s in enumerate(page_lines))
        offset += len(page_lines)
    closing = re.compile(r"^(?:respectfully(?: yours| submitted)?|sincerely(?: yours)?|very truly yours|yours(?: truly| sincerely| faithfully)?|truly yours|best regards|kind regards|for your (?:complia\w*|information and compliance|guidance and compliance))\s*[,.;:!]*$", re.I)
    role = re.compile(r"\b(?:PGDH|PGADH|PGENRO|PG\s*ENRO|OFFICER|DIRECTOR|CHIEF|MAYOR|GOVERNOR|ADMINISTRATOR|SUPERVISOR|MANAGER|SECRETARY|PRESIDENT|DEAN|PRINCIPAL|HEAD|COORDINATOR)\b", re.I)
    stop = re.compile(r"^(?:cc\s*:|copy (?:furnished|to)|enclosures?\s*:|attachments?\s*:|annex\b|appendix\b|prepared by\b|reviewed by\b|approved by\b|recommending approval\b|ground floor\b|email\b|tel\b|www\.|https?:)|@", re.I)
    for i, (text, _) in enumerate(lines):
        if not closing.fullmatch(text):
            continue
        block = []
        for item in lines[i + 1:i + 15]:
            if stop.search(item[0]):
                break
            if item[0]:
                block.append(item)
        for j, (text, number) in enumerate(block[:6]):
            name = re.sub(r"\.{2,}", ".", text).strip(" |;:'‘’\"“”")
            if not 7 <= len(name) <= 110 or re.search(r"\d|[:!?@/]", name):
                continue
            if re.search(r"\b(?:REPUBLIC|PROVINCE|GOVERNMENT|OFFICE|DEPARTMENT|DIVISION|PERSONNEL|SUBJECT|ORDER|COMPLIANCE|DIRECTOR|MAYOR|CHIEF|GOVERNOR|SECRETARY|MANAGER|PLEASE|THANK|SHOULD|MUST|REQUEST)\b", name, re.I):
                continue
            words = re.findall(r"[A-Za-zÀ-ž][A-Za-zÀ-ž.'’-]*", name)
            if not 2 <= len(words) <= 12 or sum(len(re.sub(r"[^A-Za-zÀ-ž]", "", w)) >= 2 for w in words) < 2:
                continue
            designation = block[j + 1][0] if j + 1 < len(block) else ""
            titled = re.match(r"^(?:EnP|Engr|Atty|Dr|Hon|Mr|Ms|Mrs|Prof)\.?\s+", name, re.I)
            title_case = all(re.match(r"^[A-ZÀ-Þ]", w) or re.fullmatch(r"de|del|dela|la|van|von", w, re.I) for w in words)
            if name != name.upper() and not ((titled or title_case) and role.search(designation)):
                continue
            return {"name": name, "designation": designation.strip(" |;:") if role.search(designation) else "", "line": number}
    return {"name": "", "designation": "", "line": None}


def clean_printed_ink(image):
    """Suppress blue pen strokes while preserving the remaining printed text."""
    from PIL import Image
    rgb = image.convert("RGB")
    cleaned = []
    removed = 0
    for r, g, b in rgb.getdata():
        if b - r > 12 and b > g + 3 and min(r, g, b) < 220:
            cleaned.append((255, 255, 255))
            removed += 1
        else:
            cleaned.append((r, g, b))
    if removed < max(150, rgb.width * .12):
        return None
    result = Image.new("RGB", rgb.size)
    result.putdata(cleaned)
    return result


def docx_text(path, image_reader=None):
    """Preserve Word text order and optionally read embedded printed scans."""
    import posixpath
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    drawing = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
    relations = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
    with ZipFile(path) as archive:
        entry = archive.getinfo("word/document.xml")
        if entry.file_size > 25 * 1024 * 1024:
            raise ValueError("The Word document text exceeds the reader limit.")
        body = ET.fromstring(archive.read(entry)).find(ns + "body")
        images = {}
        if image_reader and "word/_rels/document.xml.rels" in archive.namelist():
            for relation in ET.fromstring(archive.read("word/_rels/document.xml.rels")):
                if relation.get("Type", "").endswith("/image") and relation.get("TargetMode") != "External":
                    target = posixpath.normpath("word/" + relation.get("Target", ""))
                    if target.startswith("word/media/"):
                        images[relation.get("Id")] = target
        scans = 0
        def walk(node, cell=False):
            nonlocal scans
            tag = node.tag.removeprefix(ns)
            if tag == "t":
                return node.text or ""
            if tag == "br":
                return "\f" if node.get(ns + "type") == "page" else "\n"
            if tag == "tab":
                return "  "
            if node.tag == drawing + "blip" and image_reader:
                target = images.get(node.get(relations + "embed"))
                if target and archive.getinfo(target).file_size <= 25 * 1024 * 1024:
                    text = image_reader(archive.read(target)) or ""
                    if text.strip():
                        page_scan = len(text.strip()) >= 120
                        prefix = "\n\f\n" if scans and page_scan else "\n"
                        scans += int(page_scan)
                        return prefix + text + "\n"
                return ""
            text = "".join(walk(child, cell or tag == "tc") for child in node)
            if tag == "p":
                return text + ("\n" if cell else "\n\n")
            if tag == "tc":
                return text.strip() + "  "
            if tag == "tr":
                return text.strip() + "\n"
            return text
        return walk(body).strip() if body is not None else ""

LABELS = (r"SUBJECT MATTER|SUBJECT|SUBJ|RE|ADDRESSED TO|MEMORANDUM FOR|RECIPIENT OFFICE|"
          r"RECEIVED FROM|SENDER|ISSUED BY|ISSUING OFFICE|ORIGINATING OFFICE|SIGNATORY|"
          r"DATE RECEIVED|RECEIVED DATE|DATE RELEASED|RELEASED DATE|DATE ISSUED|DATE|DATED|"
          r"TO|T0|FROM|FOR|THROUGH|THRU|CC|ATTACHMENTS?|REFERENCE(?: NO\.?| NUMBER)?|"
          r"REF(?: NO\.?)?|CONTROL (?:NO\.?|NUMBER)|REMARKS")
LABEL_RE = re.compile(r"^(" + LABELS + r")\s*(?::|[–—-])\s*(.*)$", re.I)
BARE_RE = re.compile(r"^(?:" + LABELS + r")\s*$", re.I)
DATE_LINE_RE = re.compile(r"^(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}|[A-Za-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\.?,?\s+\d{4})\s*$", re.I)
BODY_RE = re.compile(r"^(?:dear\b|sir\b|madam\b|respectfully\b|sincerely\b|please\b|kindly\b|"
                     r"you are\b|this (?:is|memo|memorandum|office|letter)\b|pursuant\b|"
                     r"in (?:connection|view|compliance|light)\b|for your (?:information|compliance|guidance)\b|"
                     r"we (?:are|would|request)\b|attached (?:is|are)\b|relative to\b|\d+\.\s)", re.I)
PREFIX = r"(?:(?:PG\s*ENRO|PGENRO|PROVINCIAL ENRO)\s+)?"
MEMO_RE = re.compile(r"^" + PREFIX + r"(?:OFFICE\s+)?(?:MEMORANDUM(?:\s+(?:ORDER|CIRCULAR))?|MEMO)"
                     r"(?:\s+(?:N[O0]\.?|NUMBER)\s*[:#.-]?\s*[A-Z0-9 /._,-]*|\s+FOR\s*:?.*|"
                     r"\s*[:#.-]?\s*\d[\d /._,-]*)?\s*$", re.I)
TYPES = ("Office Order", "Special Order", "Travel Order", "Request Letter", "Endorsement Letter",
         "Transmittal Letter", "Response Letter", "Notice of Meeting", "Invitation", "Report")
MONTHS = {name.lower(): i for i, name in enumerate(("", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")) if name}
MONTHS.update({name[:3]: value for name, value in tuple(MONTHS.items())})
MONTHS["sept"] = 9


def parse_date(value=""):
    value = str(value or "").strip()
    year = month = day = None
    match = re.search(r"\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b", value)
    if match:
        year, month, day = map(int, match.groups())
    else:
        match = re.search(r"\b([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b", value, re.I)
        if match:
            month, day, year = MONTHS.get(match[1].lower()), int(match[2]), int(match[3])
        else:
            match = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?,?\s+(\d{4})\b", value, re.I)
            if match:
                day, month, year = int(match[1]), MONTHS.get(match[2].lower()), int(match[3])
            else:
                match = re.search(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b", value)
                if match:
                    first, second, year = map(int, match.groups())
                    if first > 12 >= second or first == second:
                        day, month = first, second
                    elif second > 12 >= first:
                        month, day = first, second
    try:
        return datetime.date(year, month, day).isoformat()
    except (ValueError, TypeError):
        return ""


def parse_header(text=""):
    author = printed_signatory(text)
    text = str(text or "").replace("\r", "").split("\f", 1)[0].replace("\u00a0", " ").replace("：", ":")
    text = re.sub(r"^(?:SUBJECI|SUB3ECT|SUBIECT)\s*(?=[:\-])", "SUBJECT", text, flags=re.I | re.M)
    text = re.sub(r"^(" + LABELS + r")[ \t]{2,}(?=\S)", r"\1: ", text, flags=re.I | re.M)
    text = re.sub(r"[ \t]{2,}(?=(?:" + LABELS + r")\s*:)", "\n", text, flags=re.I)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    body = next((i for i, line in enumerate(lines) if BODY_RE.match(line)), len(lines))
    lines = lines[:min(body, 100)]
    evidence = {}
    result = {key: "" for key in ("controlNo", "memoNo", "date", "receivedDate", "releasedDate", "recipient", "sourceOffice", "issuedBy", "subject", "signatory", "documentType")}
    result.update(isMemo=False, fieldEvidence=evidence, needsReview=[])
    subject_index = next((i for i, line in enumerate(lines) if re.match(r"^(?:SUBJECT(?: MATTER)?|SUBJ|RE)\s*(?::|[–—-]|$)", line, re.I)), len(lines))
    if subject_index < len(lines):
        subject_label = LABEL_RE.match(lines[subject_index])
        content = bool(subject_label and subject_label[2])
        for i in range(subject_index + 1, len(lines)):
            if lines[i]:
                if not LABEL_RE.match(lines[i]) and not BARE_RE.fullmatch(lines[i]):
                    content = True
                continue
            following = next((line for line in lines[i + 1:] if line), "")
            if content and following and not LABEL_RE.match(following) and not BARE_RE.fullmatch(following) and not DATE_LINE_RE.fullmatch(following) and not re.match(r"^(?:FOR|OF|ON|AND|OR|WITH|REGARDING|DURING)\b", following, re.I):
                lines = lines[:i]
                break
    heading = -1
    for i, line in enumerate(lines[:min(subject_index, 60)]):
        title = line.replace("MEM0RANDUM", "MEMORANDUM")
        if MEMO_RE.fullmatch(title):
            heading = i; result.update(documentType="Memorandum", isMemo=True); break
        doc_type = next((name for name in TYPES if re.fullmatch(PREFIX + name.replace(" ", r"\s+") + r"(?:\s+(?:N[O0]\.?|NUMBER)\s*[:#.-]?.*|\s*[:#.-]?\s*\d[\d /._,-]*)?\s*", title, re.I)), "")
        if doc_type:
            heading = i; result["documentType"] = doc_type; break

    def field(names, limit=6):
        names = re.compile(r"^(?:" + names + r")$", re.I)
        for i, line in enumerate(lines):
            match = LABEL_RE.match(line)
            if not ((match and names.fullmatch(match[1])) or names.fullmatch(line)):
                continue
            parts = [match[2]] if match and match[2] else []
            j = i + 1
            while j < min(len(lines), i + 1 + limit):
                following = lines[j]
                if not following:
                    probe = j + 1
                    while probe < len(lines) and not lines[probe] and probe - j <= 2:
                        probe += 1
                    if probe < len(lines) and probe - j <= 2 and (not parts or (re.match(r"^(?:FOR|OF|ON|AND|OR|WITH|REGARDING|DURING)\b", lines[probe], re.I) and not BODY_RE.match(lines[probe]) and not LABEL_RE.match(lines[probe]))):
                        j = probe
                        continue
                    break
                if LABEL_RE.match(following) or BARE_RE.fullmatch(following) or BODY_RE.match(following) or MEMO_RE.fullmatch(following) or re.fullmatch(r"[-_=]{3,}", following):
                    break
                if limit == 1 and parts:
                    break
                parts.append(following)
                j += 1
            value = " ".join(parts).strip()
            if value:
                return value, "\n".join(lines[i:j])
        return "", ""

    if heading >= 0:
        block = lines[heading:heading + 5]
        end = next((i for i, line in enumerate(block) if i and (LABEL_RE.match(line) or BARE_RE.fullmatch(line))), len(block))
        number_text = "\n".join(block[:end])
        number = re.search(r"\b(?:N[O0]\.?|NUMBER)\s*[:#.-]?\s*([A-Z0-9][A-Z0-9/._-]*)", number_text, re.I) or re.search(r"(?:MEMORANDUM(?:\s+(?:ORDER|CIRCULAR))?|MEMO|ORDER)\s*[:#.-]?\s*(\d[\d/._-]*)", block[0], re.I)
        if number:
            series = re.search(r"(?:[,;]\s*s\.?\s*|\bseries(?:\s+of)?\s+)(\d{4})\b", number_text, re.I)
            result["controlNo"] = number[1] + (", s. " + series[1] if series else "")
            evidence["controlNo"] = number_text
            if result["isMemo"]:
                result["memoNo"] = result["controlNo"]
    printed, printed_source = field(r"CONTROL (?:NO\.?|NUMBER)", 1)
    control, source = (printed, printed_source) if printed else field(r"REFERENCE(?: NO\.?| NUMBER)?|REF(?: NO\.?)?", 1)
    if (printed or not result["controlNo"]) and re.fullmatch(r"[A-Z0-9][A-Z0-9/._-]*(?:,?\s*s\.?\s*\d{4})?", control, re.I):
        result["controlNo"] = control; evidence["controlNo"] = source
        if result["isMemo"] and not result["memoNo"]:
            result["memoNo"] = control
    for key, names in {"recipient": r"TO|T0|FOR|ADDRESSED TO|MEMORANDUM FOR|RECIPIENT OFFICE", "issuedBy": r"FROM|ISSUED BY|ISSUING OFFICE|ORIGINATING OFFICE|SIGNATORY", "sourceOffice": r"RECEIVED FROM|FROM|SENDER|ORIGINATING OFFICE|ISSUING OFFICE", "subject": r"SUBJECT|SUBJECT MATTER|SUBJ|RE", "signatory": "SIGNATORY"}.items():
        result[key], evidence[key] = field(names)
    if not result["sourceOffice"]:
        first_label = next((i for i, line in enumerate(lines) if LABEL_RE.match(line) or BARE_RE.fullmatch(line)), len(lines))
        first_date = next((i for i, line in enumerate(lines) if DATE_LINE_RE.fullmatch(line)), len(lines))
        top = lines[:min(heading if heading >= 0 else len(lines), subject_index, first_label, first_date, 20)]
        offices = [line for line in top if re.search(r"\b(?:OFFICE|DEPARTMENT|BUREAU|DIVISION|COMMISSION|AUTHORITY|UNIVERSITY)\b", line, re.I) and not any(re.search(name, line, re.I) for name in TYPES) and not re.match(r"^(?:email|tel|contact|www\.|https?:)", line, re.I)]
        if offices:
            result["sourceOffice"] = offices[-1]; evidence["sourceOffice"] = offices[-1]
    result["senderOffice"] = result["sourceOffice"]
    if author["name"]:
        result["signatory"] = author["name"]
        evidence["signatory"] = author["name"]
        if not field(r"RECEIVED FROM|FROM|SENDER|ORIGINATING OFFICE|ISSUING OFFICE")[0]:
            result["sourceOffice"] = author["name"]
            evidence["sourceOffice"] = author["name"]
        if not result["issuedBy"]:
            result["issuedBy"] = author["name"]
            evidence["issuedBy"] = author["name"]
    for key, names in {"date": "DATE|DATE ISSUED|DATED", "receivedDate": "DATE RECEIVED|RECEIVED DATE", "releasedDate": "DATE RELEASED|RELEASED DATE"}.items():
        value, source = field(names, 1)
        if value:
            result[key] = parse_date(value); evidence[key] = source
    if not evidence.get("date"):
        for line in lines:
            if DATE_LINE_RE.fullmatch(line):
                result["date"] = parse_date(line); evidence["date"] = line; break
    result["needsReview"] = [key for key in ("controlNo", "date", "recipient", "subject", "sourceOffice") if not result[key]]
    result["extractionVersion"] = "printed-v4"
    return result
