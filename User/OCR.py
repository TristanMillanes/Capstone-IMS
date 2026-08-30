from flask import Flask, request, jsonify
from flask_cors import CORS
import pytesseract
from PIL import Image
import fitz
import os

app = Flask(__name__)
CORS(app)

# Change this if your Tesseract is installed elsewhere
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


@app.route("/")
def home():
    return "OCR Server Running"


@app.route("/ocr", methods=["POST"])
def ocr():

    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]

    filepath = os.path.join(UPLOAD_FOLDER, file.filename)
    file.save(filepath)

    text = ""

    # PDF
    if file.filename.lower().endswith(".pdf"):

        pdf = fitz.open(filepath)

        for page in pdf:
            page_text = page.get_text()

            if page_text.strip() == "":
                pix = page.get_pixmap(dpi=200)
                image_path = "temp.png"
                pix.save(image_path)

                img = Image.open(image_path)
                page_text = pytesseract.image_to_string(img)
                img.close()

                os.remove(image_path)

            text += page_text + "\n"

        pdf.close()

    # Image
    elif file.filename.lower().endswith((".png", ".jpg", ".jpeg")):

        img = Image.open(filepath)
        text = pytesseract.image_to_string(img)
        img.close()

    else:
        return jsonify({"error": "Unsupported file"}), 400

    return jsonify({
        "filename": file.filename,
        "text": text
    })


if __name__ == "__main__":
    app.run(debug=True)