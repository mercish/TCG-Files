import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const zipPath = path.join(root, "Emulator", "downloads", "OSFR.Client.zip");
const ps = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [IO.Compression.ZipFile]::OpenRead(${JSON.stringify(zipPath)})
$matches = $z.Entries | Where-Object { $_.FullName -match 'tcg|AssetsTcg|cards\\.rcc|FreeRealmsTCG' }
$matches | Select-Object -First 40 FullName, Length
Write-Output "---"
Write-Output ("MATCH_COUNT=" + @($matches).Count)
Write-Output ("TOTAL=" + $z.Entries.Count)
$z.Dispose()
`;
const out = execSync(`powershell -NoProfile -Command ${JSON.stringify(ps)}`, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
});
console.log(out);
