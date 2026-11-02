@echo off
REM SPDX-License-Identifier: Apache-2.0
REM Copyright 2026 Leon Priest (GitHub: 7h3v01d)
cd /d "%~dp0"
if not exist node_modules (
  echo Installing test dependencies...
  call npm install || exit /b 1
)
call npm test
