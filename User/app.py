from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import pytesseract
from PIL import Image
import fitz
import os
from werkzeug.utils import secure_filename

app = Flask(__name__)
CORS(app)

# TESSERACT PATH
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

UPLOAD_FOLDER = "uploads"
PREVIEW_FOLDER = "previews"

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(PREVIEW_FOLDER, exist_ok=True)


@app.route("/")
def home():
    return "OCR server is running"


@app.route("/ocr", methods=["POST"])
def ocr_file():
    try:

        if "file" not in request.files:
            return jsonify({"error": "No file uploaded"}), 400

        file = request.files["file"]

        if file.filename == "":
            return jsonify({"error": "No selected file"}), 400

        filename = secure_filename(file.filename)

        file_path = os.path.join(UPLOAD_FOLDER, filename)

        file.save(file_path)

        pages = []
        full_text = ""

        # PDF
        if filename.lower().endswith(".pdf"):

            pdf = fitz.open(file_path)

            for i, page in enumerate(pdf):

                page_number = i + 1

                text = page.get_text().strip()

                pix = page.get_pixmap(dpi=150)

                preview_name = f"{filename}_page_{page_number}.png"

                preview_path = os.path.join(PREVIEW_FOLDER, preview_name)

                pix.save(preview_path)

                # OCR if empty
                if not text:

                    image = Image.open(preview_path)

                    text = pytesseract.image_to_string(image)

                pages.append({
                    "page_number": page_number,
                    "text": text,
                    "preview_url": f"http://127.0.0.1:5000/previews/{preview_name}"
                })

                full_text += f"\n\n--- PAGE {page_number} ---\n{text}"

            pdf.close()

        # IMAGE
        elif filename.lower().endswith((".png", ".jpg", ".jpeg")):

            image = Image.open(file_path)

            text = pytesseract.image_to_string(image)

            pages.append({
                "page_number": 1,
                "text": text,
                "preview_url": None
            })

            full_text = text

        else:
            return jsonify({
                "error": "Unsupported file type"
            }), 400

        return jsonify({
            "filename": filename,
            "text": full_text,
            "pages": pages
        })

    except Exception as e:

        print("ERROR:", str(e))

        return jsonify({
            "error": str(e)
        }), 500


@app.route("/previews/<filename>")
def previews(filename):
    return send_from_directory(PREVIEW_FOLDER, filename)


if __name__ == "__main__":
    app.run(debug=True, port=5000)