@echo off
REM SPDX-License-Identifier: Apache-2.0
REM Copyright 2026 Leon Priest (GitHub: 7h3v01d)
REM Builds dist\clearcut-<version>.zip with only the files the browser needs.
cd /d "%~dp0"
for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "(Get-Content manifest.json -Raw | ConvertFrom-Json).version"`) do set VER=%%v
if not exist dist mkdir dist
set OUT=dist\clearcut-%VER%.zip
if exist "%OUT%" del "%OUT%"
powershell -NoProfile -Command "Compress-Archive -Path manifest.json,LICENSE,NOTICE,icons,rules,src -DestinationPath '%OUT%'"
echo Built %OUT%
