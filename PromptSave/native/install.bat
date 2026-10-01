@echo off
setlocal DisableDelayedExpansion
title PromptSave - Install local bridge
if not exist "%~dp0install.ps1" (
  echo ERROR: install.ps1 was not found next to this BAT file.
  pause
  exit /b 1
)
echo This will deploy the PromptSave local bridge to your Documents folder:
echo   %%USERPROFILE%%\Documents\PromptSave\native
echo and register it for Chrome / Edge. The extension folder can stay anywhere.
echo No admin rights are required. Close this window to cancel.
echo.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set "installResult=%errorlevel%"
echo.
if "%installResult%"=="0" (
  echo Installation finished. Reload the extension and connect your data folder.
) else (
  echo Installation failed. Review the PowerShell error above.
)
pause
exit /b %installResult%
