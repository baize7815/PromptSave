param(
    [string[]]$ExtensionId,
    [string]$PythonPath,
    [string]$InstallDir,
    [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$hostName = 'com.promptshelf.local'
# The script always runs from its own folder; after deployment that is the
# installed location, so re-running it repairs the registration in place.
$sourceRoot = [IO.Path]::GetFullPath($PSScriptRoot)

$registryPaths = @(
    "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName",
    "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName"
)

function Test-BridgeManifest {
    param([string]$Path)
    if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return $false }
    try {
        $manifest = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
        return ($manifest.name -eq $hostName)
    } catch {
        return $false
    }
}

# This script is run explicitly by the user. It never installs Python or needs admin rights.
if ($Uninstall) {
    foreach ($registryPath in $registryPaths) {
        if (Test-Path -LiteralPath $registryPath) {
            $registered = (Get-Item -LiteralPath $registryPath).GetValue('')
            # Remove our own keys, including stale entries whose manifest is gone.
            # A key that points at another program's valid manifest is left untouched.
            if ($registered -and (Test-Path -LiteralPath $registered) -and -not (Test-BridgeManifest -Path $registered)) {
                throw "另一个程序占用了 $registryPath，未更改。"
            }
            Remove-Item -LiteralPath $registryPath
        }
    }
    Write-Host '已取消当前用户的 Chrome / Edge 桥接注册。'
    Write-Host '部署目录、数据文件夹连接记录（grants）和收藏数据均保留；如需彻底删除请手动删除部署目录。'
    return
}

# 1. Deploy location: Documents\PromptSave\native by default, overridable with -InstallDir.
#    The bridge is fully independent of where the extension folder lives.
if (-not $InstallDir) {
    $documents = [Environment]::GetFolderPath('MyDocuments')
    if (-not $documents) { throw '无法定位“文档”文件夹，请用 -InstallDir 参数指定桥接安装目录。' }
    $InstallDir = Join-Path $documents 'PromptSave\native'
}
$bridgeRoot = [IO.Path]::GetFullPath($InstallDir)

if (-not $ExtensionId) {
    $entered = Read-Host '输入扩展 ID（Chrome / Edge 有多个 ID 时用逗号分隔；在扩展管理页面复制）'
    $ExtensionId = $entered -split '[,;\s]+' | Where-Object { $_ }
}
$ExtensionId = @($ExtensionId | ForEach-Object { $_.Trim() } | Select-Object -Unique)
if (-not $ExtensionId.Count) { throw '至少需要一个扩展 ID。' }
foreach ($id in $ExtensionId) {
    if ($id -cnotmatch '^[a-p]{32}$') { throw "扩展 ID 格式无效：$id" }
}

if (-not $PythonPath) {
    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($pythonCommand -and $pythonCommand.Source -notmatch '\\WindowsApps\\') {
        $PythonPath = $pythonCommand.Source
    } else {
        $PythonPath = Read-Host '输入现有 Python 3 的 python.exe 完整路径（需要包含 tkinter）'
    }
}
$PythonPath = [IO.Path]::GetFullPath($PythonPath)
if (-not (Test-Path -LiteralPath $PythonPath -PathType Leaf) -or
    [IO.Path]::GetFileName($PythonPath) -ne 'python.exe') {
    throw '找不到 python.exe；本脚本不会自动安装运行时。'
}

# 2. Copy program files into the deploy directory. Existing grants (data-folder
#    links), launch.cmd and the host manifest are never deleted by this copy.
New-Item -ItemType Directory -Force -Path $bridgeRoot | Out-Null
foreach ($name in @('host.py', 'install.bat', 'install.ps1', 'README.md')) {
    $src = Join-Path $sourceRoot $name
    $dst = Join-Path $bridgeRoot $name
    if (-not (Test-Path -LiteralPath $src)) { continue }
    $sameLocation = (Test-Path -LiteralPath $dst) -and
        [IO.Path]::GetFullPath($src).Equals([IO.Path]::GetFullPath($dst), [StringComparison]::OrdinalIgnoreCase)
    if (-not $sameLocation) { Copy-Item -LiteralPath $src -Destination $dst -Force }
}
if (-not (Test-Path -LiteralPath (Join-Path $bridgeRoot 'host.py') -PathType Leaf)) {
    throw '部署目录缺少 host.py，请确认安装脚本来自完整的 native 文件夹。'
}

# Launcher goes through cmd.exe; reject metacharacters that could alter its arguments.
foreach ($path in @($bridgeRoot, $PythonPath)) {
    if ($path -match '[%"!\r\n&|<>^()]' -or $path -notmatch '^[A-Za-z]:\\') {
        throw '桥接和 Python 需放在本地磁盘，路径不能包含 cmd 特殊字符。'
    }
}
if ($bridgeRoot -match 'OneDrive') {
    Write-Warning '部署目录位于 OneDrive 同步文件夹内，同步冲突可能影响桥接运行；如遇异常可用 -InstallDir 指定其他本地目录。'
}

$manifestPath = Join-Path $bridgeRoot "$hostName.json"

# 3. Do not overwrite a registry value that belongs to another valid bridge install.
foreach ($registryPath in $registryPaths) {
    if (Test-Path -LiteralPath $registryPath) {
        $registered = (Get-Item -LiteralPath $registryPath).GetValue('')
        if ($registered -and
            -not [IO.Path]::GetFullPath($registered).Equals([IO.Path]::GetFullPath($manifestPath), [StringComparison]::OrdinalIgnoreCase) -and
            (Test-BridgeManifest -Path $registered)) {
            throw "另一个 PromptSave 桥接安装占用了 $registryPath，请先对其运行 install.ps1 -Uninstall。"
        }
    }
}

$launcherPath = Join-Path $bridgeRoot 'launch.cmd'
# Use an ASCII launcher. Windows short paths keep non-ASCII Python paths representable.
$filesystem = New-Object -ComObject Scripting.FileSystemObject
$pythonShortPath = $filesystem.GetFile($PythonPath).ShortPath
if ($pythonShortPath -match '[^\x00-\x7F]') {
    throw 'Python 路径含中文且系统没有可用的短路径，请使用纯英文路径下的现有 Python。'
}
$launcher = "@echo off`r`nsetlocal DisableDelayedExpansion`r`n`"$pythonShortPath`" -I -u `"%~dp0host.py`" %*`r`n"
[IO.File]::WriteAllText($launcherPath, $launcher, [Text.Encoding]::ASCII)
$hostManifest = [ordered]@{
    name = $hostName
    description = 'PromptSave local directory storage and Windows Explorer bridge'
    path = $launcherPath
    type = 'stdio'
    allowed_origins = @($ExtensionId | ForEach-Object { "chrome-extension://$_/" })
}
[IO.File]::WriteAllText($manifestPath, ($hostManifest | ConvertTo-Json -Depth 4),
    (New-Object Text.UTF8Encoding($false)))
foreach ($registryPath in $registryPaths) {
    New-Item -Path $registryPath -Force | Out-Null
    Set-Item -LiteralPath $registryPath -Value $manifestPath
}

Write-Host ''
Write-Host '桥接已部署并注册：'
Write-Host "  部署目录 : $bridgeRoot"
Write-Host "  Python   : $PythonPath"
Write-Host "  扩展 ID  : $($ExtensionId -join ', ')"
Write-Host '重新加载扩展，在设置中点击“连接本地目录（免重复授权）”，选择数据储存文件夹。'
Write-Host '扩展文件夹以后可任意移动，桥接不受影响；仅当扩展 ID 改变（扩展换位置后重新加载）时，重新双击部署目录里的 install.bat 并输入新 ID。'
Write-Host '取消注册：在部署目录中运行 install.ps1 -Uninstall（收藏与 grants 连接记录会保留）。'
