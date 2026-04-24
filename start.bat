@echo off
chcp 65001 >nul
title HTML 原型管理服务

echo.
echo  ==========================================
echo   HTML 原型管理服务 - 启动中...
echo  ==========================================
echo.

cd /d "%~dp0"

:: 检查 8111 端口是否已被占用
netstat -ano | findstr ":8111 " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo  [警告] 端口 8111 已被占用，请先关闭旧服务。
    echo.
    pause
    exit /b 1
)

:: 检查 Python 是否可用
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [错误] 未找到 Python，请确认已安装并加入 PATH。
    echo.
    pause
    exit /b 1
)

echo  服务地址: http://localhost:8111
echo  按 Ctrl+C 可停止服务
echo.
echo  ==========================================
echo.

python app.py

echo.
echo  服务已停止。
pause
