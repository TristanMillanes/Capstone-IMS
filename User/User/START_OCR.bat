@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  where py >nul 2>nul
  if errorlevel 1 (
    python -m venv .venv
  ) else (
    py -3 -m venv .venv
  )
  if errorlevel 1 goto setup_error
)
".venv\Scripts\python.exe" -m pip install -r requirements-ocr.txt
if errorlevel 1 goto setup_error
".venv\Scripts\python.exe" OCR.py
if errorlevel 1 goto setup_error
exit /b 0
:setup_error
echo.
echo The OCR reader could not start. Check the error above and your Python installation.
pause
exit /b 1
