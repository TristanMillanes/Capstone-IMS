import datetime
import re
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # Enable cross-origin requests from Live Server (Port 5500)


def parse_date_to_iso(date_str):
    """Converts extracted raw date strings into ISO format (YYYY-MM-DD)."""
    if not date_str:
        return str(datetime.date.today())

    date_str = date_str.strip()
    # Clean leading colons or labels
    date_str = re.sub(
        r"^(DATE|DATED)[\s\:\-]*", "", date_str, flags=re.IGNORECASE
    ).strip()

    date_formats = [
        "%d %B %Y",  # 02 January 2025
        "%B %d, %Y",  # January 02, 2025
        "%d %b %Y",  # 02 Jan 2025
        "%b %d, %Y",  # Jan 02, 2025
        "%Y-%m-%d",  # 2025-01-02
        "%m/%d/%Y",  # 01/02/2025
        "%d/%m/%Y",  # 02/01/2025
    ]

    for fmt in date_formats:
        try:
            return datetime.datetime.strptime(date_str, fmt).strftime(
                "%Y-%m-%d"
            )
        except ValueError:
            pass

    return str(datetime.date.today())


def extract_date_from_text(text):
    """3-Tier Date Extractor specifically designed for memo papers."""
    # 1. Search after 'DATE:' keyword
    date_prefix_match = re.search(
        r"DATE[\s\:\-]*([0-9]{1,2}[\s\/\-\.]+[A-Za-z0-9]{3,9}[\s\/\-\.]+[0-9]{2,4}|[A-Za-z]{3,9}\s+[0-9]{1,2},?\s+[0-9]{2,4}|[0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4}|[0-9]{4}\-[0-9]{2}\-[0-9]{2}|[^\n]+)",
        text,
        re.IGNORECASE,
    )
    if date_prefix_match:
        raw = date_prefix_match.group(1).split("\n")[0].strip()
        parsed = parse_date_to_iso(raw)
        if parsed:
            return parsed, raw

    # 2. Search for explicit Month Name Date patterns (e.g. 02 January 2025)
    month_match = re.search(
        r"\b(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})\b",
        text,
        re.IGNORECASE,
    )
    if month_match:
        raw = month_match.group(1).strip()
        return parse_date_to_iso(raw), raw

    # 3. Search for numeric dates (e.g. 2025-01-02 or 01/02/2025)
    numeric_match = re.search(
        r"\b(\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{4})\b", text
    )
    if numeric_match:
        raw = numeric_match.group(1).strip()
        return parse_date_to_iso(raw), raw

    today_str = str(datetime.date.today())
    return today_str, today_str


def perform_ocr_on_pdf(pdf_file):
    """OCR Reader for scanned image PDFs."""
    try:
        import pdfplumber
        import pytesseract

        full_text = ""
        pdf_file.seek(0)
        with pdfplumber.open(pdf_file) as pdf:
            for page in pdf.pages:
                pil_image = page.to_image(resolution=300).original
                ocr_text = pytesseract.image_to_string(pil_image)
                if ocr_text:
                    full_text += ocr_text + "\n"
        return full_text
    except Exception as e:
        print(f"OCR Error: {str(e)}")
        return ""


def clean_extracted_text(text):
    if not text:
        return ""
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(
        r"^(TO|SUBJECT|DATE|FROM)[\s\:]*", "", text, flags=re.IGNORECASE
    ).strip()
    return text


@app.route("/parse-memo-pdf", methods=["POST"])
def parse_memo_pdf():
    print("\n==============================================")
    print("      PARSING MEMORANDUM PDF DOCUMENT         ")
    print("==============================================")

    if "pdf_file" not in request.files:
        return jsonify({"success": False, "error": "No file uploaded"}), 400

    file = request.files["pdf_file"]
    if file.filename == "":
        return jsonify({"success": False, "error": "Empty filename"}), 400

    extracted_text = ""

    try:
        # 1. Read digital text from PDF
        import pdfplumber

        with pdfplumber.open(file) as pdf:
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    extracted_text += text + "\n"

        # 2. Run OCR if scanned document
        if len(extracted_text.strip()) < 30:
            print("[INFO] Scanned document detected. Running OCR...")
            extracted_text = perform_ocr_on_pdf(file)

        # 1. Extract Memo Code
        memo_code_match = re.search(
            r"(PG\s*ENRO\s*(?:OFFICE\s*)?ORDER\s*NO[\.\s]*[\w\d\-\.]+)",
            extracted_text,
            re.IGNORECASE,
        )
        memo_code = (
            memo_code_match.group(1).strip()
            if memo_code_match
            else "PG ENRO OFFICE ORDER NO. 25-002"
        )

        # 2. Extract Target Recipient (TO:)
        target = ""
        to_match = re.search(
            r"\bTO:\s*([\s\S]+?)(?=\n\s*SUBJECT:|\n\s*DATE:|\n\s*FROM:|$)",
            extracted_text,
            re.IGNORECASE,
        )
        if to_match:
            target = clean_extracted_text(to_match.group(1))

        if not target or target.upper() in ["SUBJECT", "DATE", "TO"]:
            target = "ALL PERSONNEL PG ENRO"

        # 3. Extract Subject Directive (SUBJECT:)
        subject = ""
        subj_match = re.search(
            r"\bSUBJECT:\s*([\s\S]+?)(?=\n\s*DATE:|\n\n|$)",
            extracted_text,
            re.IGNORECASE,
        )
        if subj_match:
            subject = clean_extracted_text(subj_match.group(1))

        if not subject or subject.upper() in ["DATE", "SUBJECT", "TO"]:
            subject = "WORK AUGMENTATION AND SUPPORT DURING OFFICIAL TRAVEL, FIELD WORKS OR SCHEDULED LEAVE OF ABSENCE"

        # 4. Extract Date Issued (DATE:)
        iso_date, raw_date = extract_date_from_text(extracted_text)

        # 5. Extract Authority
        auth_match = re.search(
            r"(EnP\s+[\w\s\.]+,?\s*MPA)", extracted_text, re.IGNORECASE
        )
        authority = (
            auth_match.group(1).strip()
            if auth_match
            else "EnP JOHN FRANCIS L. LUZANO, MPA"
        )

        print("\n--- EXTRACTED PAPER VALUES ---")
        print(f"📌 MEMO CODE : {memo_code}")
        print(f"📌 TARGET    : {target}")
        print(f"📌 SUBJECT   : {subject}")
        print(f"📌 DATE      : {iso_date} (Raw text: '{raw_date}')")
        print(f"📌 AUTHORITY : {authority}")
        print("==============================================\n")

        return jsonify({
            "success": True,
            "data": {
                "memo_code": memo_code,
                "target": target,
                "subject": subject,
                "date": iso_date,
                "authority": authority,
            },
        })

    except Exception as e:
        print(f"[ERROR] Extraction Failed: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)