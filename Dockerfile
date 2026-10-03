FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    OCR_LANG=eng \
    OCR_WORKERS=1 \
    OCR_DPI=220 \
    OCR_MAX_SIDE=2800 \
    OCR_TIMEOUT=45 \
    OCR_DOCUMENT_TIMEOUT=180

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       tesseract-ocr \
       tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./requirements.txt
COPY User/requirements-ocr.txt ./User/requirements-ocr.txt
RUN python -m pip install --upgrade pip \
    && pip install -r requirements.txt

COPY . .

EXPOSE 10000

CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT:-10000} --workers 1 --threads 4 --timeout 210 --graceful-timeout 30 --access-logfile - --error-logfile - ocr_server:app"]
