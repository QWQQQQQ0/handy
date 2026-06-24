# 检查管理员权限，如果没有则请求提升权限
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "需要管理员权限。请求提升权限..." -ForegroundColor Yellow
    $scriptPath = $MyInvocation.MyCommand.Definition
    Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`"" -Verb RunAs
    exit
}

# 定义常见安装路径来查找QQ音乐
$qqMusicPaths = @(
    "$env:ProgramFiles\Tencent\QQMusic\QQMusic.exe",
    "$env:ProgramFiles(x86)\Tencent\QQMusic\QQMusic.exe"
)

# 初始化变量
$qqMusicExe = $null

# 遍历路径查找可执行文件
foreach ($path in $qqMusicPaths) {
    if (Test-Path $path) {
        $qqMusicExe = $path
        Write-Host "找到QQ音乐路径： $qqMusicExe" -ForegroundColor Green
        break
    }
}

# 如果未找到，提示用户输入路径
if (-not $qqMusicExe) {
    Write-Host "未在常见路径中找到QQ音乐。" -ForegroundColor Yellow
    $qqMusicExe = Read-Host "请输入QQ音乐可执行文件的完整路径"
    if (-not (Test-Path $qqMusicExe)) {
        Write-Error "指定的路径无效。脚本退出。"
        exit
    }
}

# 计算5分钟后的时间点
$scheduledTime = (Get-Date).AddMinutes(5)
Write-Host "将在 $scheduledTime 自动打开QQ音乐。" -ForegroundColor Cyan

# 定义任务名称和参数
$taskName = "AutoOpenQQMusic"
$action = New-ScheduledTaskAction -Execute $qqMusicExe
$trigger = New-ScheduledTaskTrigger -Once -At $scheduledTime
$settings = New-ScheduledTaskSettingsSet -DeleteExpiredTaskAfter "PT1M" -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

# 使用try-catch处理错误
try {
    # 创建一次性定时任务，如果存在则覆盖
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force -ErrorAction Stop
    Write-Host "定时任务 '$taskName' 已成功创建。" -ForegroundColor Green
    Write-Host "任务将在 $scheduledTime 运行QQ音乐，运行后自动删除。" -ForegroundColor Green
} catch {
    Write-Error "创建定时任务失败： $_"
    exit
}