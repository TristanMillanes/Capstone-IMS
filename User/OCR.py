from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.utils import secure_filename
import pytesseract
from PIL import Image
import fitz
from pathlib import Path
import tempfile
import os

app = Flask(__name__)
CORS(app)
app.config["MAX_CONTENT_LENGTH"] = 15 * 1024 * 1024  # 15 MB per request

# Windows default; override with TESSERACT_CMD when deploying elsewhere.
pytesseract.pytesseract.tesseract_cmd = os.getenv(
    "TESSERACT_CMD",
    r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)

UPLOAD_FOLDER = Path(os.getenv("OCR_UPLOAD_DIR", Path(__file__).resolve().parent / "uploads"))
UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)
ALLOWED_EXTENSIONS = {"pdf", "png", "jpg", "jpeg"}


def allowed_file(filename: str) -> bool:
    return bool(filename and "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS)


def json_error(message: str, status: int):
    return jsonify({"error": message}), status


@app.errorhandler(413)
def too_large(_error):
    return json_error("File is too large. Maximum upload size is 15 MB.", 413)


@app.route("/", methods=["GET"])
def home():
    return jsonify({"ok": True, "service": "PGENRO OCR", "message": "OCR Server Running"})


@app.route("/ocr", methods=["POST"])
def ocr():
    uploaded = request.files.get("file")
    if uploaded is None:
        return json_error("No file uploaded. Use the 'file' form field.", 400)

    original_name = secure_filename(uploaded.filename or "")
    if not original_name:
        return json_error("The uploaded filename is invalid.", 400)
    if not allowed_file(original_name):
        return json_error("Unsupported file. Accepted formats: PDF, PNG, JPG, JPEG.", 400)

    suffix = Path(original_name).suffix.lower()
    saved_path = None
    try:
        # Temporary file avoids collisions and never trusts client-supplied paths.
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, dir=UPLOAD_FOLDER) as temp:
            uploaded.save(temp)
            saved_path = Path(temp.name)

        text = ""
        if suffix == ".pdf":
            with fitz.open(saved_path) as pdf:
                for page_index, page in enumerate(pdf):
                    page_text = page.get_text("text") or ""
                    if not page_text.strip():
                        pix = page.get_pixmap(dpi=200, alpha=False)
                        with tempfile.NamedTemporaryFile(delete=False, suffix=".png", dir=UPLOAD_FOLDER) as image_temp:
                            image_path = Path(image_temp.name)
                        try:
                            pix.save(str(image_path))
                            with Image.open(image_path) as img:
                                page_text = pytesseract.image_to_string(img)
                        finally:
                            image_path.unlink(missing_ok=True)
                    text += page_text.rstrip() + "\n"
        else:
            with Image.open(saved_path) as img:
                text = pytesseract.image_to_string(img)

        return jsonify({
            "filename": original_name,
            "text": text.strip(),
        })
    except Exception as exc:
        app.logger.exception("OCR processing failed")
        return json_error(f"OCR processing failed: {exc}", 500)
    finally:
        if saved_path:
            saved_path.unlink(missing_ok=True)


if __name__ == "__main__":
    app.run(host=os.getenv("OCR_HOST", "127.0.0.1"), port=int(os.getenv("OCR_PORT", "5000")), debug=False)
