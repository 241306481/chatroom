@echo off
title Chatroom Console
cd /d "%~dp0"
set PATH=%~dp0..\nodejs;%PATH%
node "%~dp0lib\console.js"
echo.
echo [Console exited]
pause