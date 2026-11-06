@echo off
setlocal
cd /d "%~dp0"
title PGENRO Admin Setup and Recovery v3
if not exist "SETUP_FIRST_ADMIN.py" goto missing_file
if exist "User\.venv\Scripts\python.exe" goto project_python
py -3 --version >nul 2>&1
if not errorlevel 1 goto python_launcher
python --version >nul 2>&1
if not errorlevel 1 goto python_command
echo Kailangan ang Python 3 na may Tcl/Tk.
echo I-enable ang "tcl/tk and IDLE" sa Python installer.
goto finished
:project_python
"User\.venv\Scripts\python.exe" SETUP_FIRST_ADMIN.py
goto finished
:python_launcher
py -3 SETUP_FIRST_ADMIN.py
goto finished
:python_command
python SETUP_FIRST_ADMIN.py
goto finished
:missing_file
echo I-extract muna ang buong ZIP sa iisang folder.
:finished
echo.
pause
