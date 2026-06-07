param(
    [string]$ZipPath = "E:\Free Realms\Free Realms\Emulator\downloads\OSFR.Client.zip"
)

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($ZipPath)
$matches = $zip.Entries | Where-Object { $_.FullName -match 'tcg|AssetsTcg|cards\.rcc|FreeRealmsTCG' }
$matches | Select-Object -First 50 FullName, Length | Format-Table -AutoSize
Write-Host "MATCH_COUNT=$($matches.Count)"
Write-Host "TOTAL=$($zip.Entries.Count)"
$zip.Dispose()
