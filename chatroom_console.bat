@echo off
title Chatroom Console
cd /d "%~dp0"
set PATH=%~dp0..\nodejs;%PATH%
rem 控制台入口是 lib\console\index.js；此前这里写的是 lib\console.js，
rem 该文件并不存在，启动器直接报 "Cannot find module"。
node "%~dp0lib\console\index.js"
echo.
echo [Console exited]
pause