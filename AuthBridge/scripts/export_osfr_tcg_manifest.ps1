param(
    [string]$ZipPath = "E:\Free Realms\Free Realms\Emulator\downloads\OSFR.Client.zip",
    [string]$OutPath = "E:\Free Realms\Free Realms\Servers\Kaine's Server\Client\tcg\AssetsTcg_manifest.txt"
)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($ZipPath)
$entry = $zip.Entries | Where-Object { $_.FullName -ieq "OSFR Client/tcg/AssetsTcg_manifest.txt" } | Select-Object -First 1
if (-not $entry) { throw "manifest not in zip" }
$dest = [IO.Path]::GetDirectoryName($OutPath)
if (-not (Test-Path $dest)) { New-Item -ItemType Directory -Path $dest -Force | Out-Null }
[IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $OutPath, $true)
$zip.Dispose()
Write-Host "Wrote $OutPath"
