@echo off
rem Starts Soundclash Visualizer in its own window (Chrome, else Edge, else the default browser).
setlocal EnableDelayedExpansion
set "APP=%~dp0dist\soundclash-visualizer.html"
if not exist "%APP%" (
  echo Could not find dist\soundclash-visualizer.html
  echo Run "npm install" and "npm run build" in this folder first.
  pause
  exit /b 1
)
set "URL=file:///%APP:\=/%"
set "URL=!URL: =%%20!"

set "BROWSER="
for %%B in (
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LocalAppData%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
) do if not defined BROWSER if exist %%B set "BROWSER=%%~B"

if defined BROWSER (
  start "" "%BROWSER%" --app="%URL%" --start-maximized
) else (
  start "" "%APP%"
)
