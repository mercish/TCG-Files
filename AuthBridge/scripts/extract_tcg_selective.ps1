param(
    [string]$ZipPath = "E:\Free Realms\Free Realms\Emulator\downloads\OSFR.Client.zip",
    [string]$DestRoot = "E:\Free Realms\Free Realms\Servers\Kaine's Server\Client\tcg",
    [string]$ZipPrefix = "OSFR Client/tcg/"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ZipPath)) {
    Write-Error "Zip not found: $ZipPath"
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zip = [IO.Compression.ZipFile]::OpenRead($ZipPath)
$entries = $zip.Entries | Where-Object {
    $_.FullName.StartsWith($ZipPrefix, [StringComparison]::OrdinalIgnoreCase) -and $_.Length -gt 0
}

if (-not $entries) {
    $zip.Dispose()
    Write-Error "No tcg entries found under '$ZipPrefix' in zip."
}

Write-Host "Extracting $($entries.Count) tcg files to $DestRoot ..."

$extracted = 0
foreach ($entry in $entries) {
    $relative = $entry.FullName.Substring($ZipPrefix.Length).Replace('/', [IO.Path]::DirectorySeparatorChar)
    $destPath = Join-Path $DestRoot $relative
    $destDir = Split-Path -Parent $destPath
    if ($destDir -and -not (Test-Path -LiteralPath $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destPath, $true)
    $extracted++
    if (($extracted % 25) -eq 0) {
        Write-Host "  ... $extracted files"
    }
}

$zip.Dispose()
Write-Host "Done. Extracted $extracted files."
