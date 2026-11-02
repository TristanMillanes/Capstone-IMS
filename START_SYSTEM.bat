@echo off
setlocal
call "%~dp0User\START_OCR.bat"
exit /b %errorlevel%
