@echo off
chcp 65001 >nul
title HTML 原型管理服务 - 关闭

echo.
echo  ==========================================
echo   HTML 原型管理服务 - 关闭中...
echo  ==========================================
echo.

:: 查找占用 8111 端口的进程 PID
set PID=
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8111 " ^| findstr "LISTENING"') do (
    set PID=%%a
)

if "%PID%"=="" (
    echo  [提示] 未发现运行中的服务（端口 8111 未被占用）。
    echo.
    pause
    exit /b 0
)

echo  正在终止进程 PID: %PID%
taskkill /PID %PID% /F >nul 2>&1

if %errorlevel%==0 (
    echo  [成功] 服务已关闭。
) else (
    echo  [失败] 终止进程失败，请手动关闭 PID: %PID%
)

echo.
pause
