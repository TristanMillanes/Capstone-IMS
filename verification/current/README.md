# Current regression checks

Run from the project root. Python checks require `User/requirements-ocr.txt` and local Tesseract. `source-checks.py` additionally requires `tinycss2` and Node.

```bash
python verification/current/ocr-regression.py
node verification/current/letter-fields.test.cjs
python -m pip install tinycss2
python verification/current/source-checks.py
```

For `app-regression.cjs`, install the UI development dependencies listed in `../ui/package.json` and a Chromium browser. The suite resolves Playwright/Lucide/PDF.js using `CODEX_PRIMARY_RUNTIME_NODE_MODULES` when supplied; otherwise set up an equivalent module directory containing `playwright`, `lucide` and `pdfjs-dist` and point that environment variable at it. `PGENRO_CHROMIUM_EXECUTABLE` selects Chromium; `PGENRO_PYTHON` selects the OCR Python interpreter.

```bash
node verification/current/app-regression.cjs
```

This starts the production combined Flask service on local port 5059 and closes it afterwards. Private Storage and database responses are simulated; real file bytes are uploaded/downloaded through the browser harness. No hosted records are changed.

`benchmark.py` generates a large-margin printed letter and a six-page PDF repeating that image. It clears caches before each cold fixture, records extracted fields and verifies updated-source accuracy. Run it with the production profile:

```bash
OCR_WORKERS=1 OCR_DPI=220 OCR_MAX_SIDE=2800 python verification/current/benchmark.py
```

For a baseline comparison, set `PGENRO_BENCH_ROOT` to an extracted copy of the original project and `PGENRO_BENCH_LABEL=baseline`. Run implementations sequentially in separate processes. The baseline report records recognition failures rather than treating faster but incorrect fields as success.
