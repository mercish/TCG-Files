/**
 * Downloads OSFR.Client.zip (if needed) and extracts only OSFR Client/tcg/* into Kaine's client tcg folder.
 * Avoids full zip expansion so locked partial extracts cannot break the run.
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { crc32, tcgRoot, clientRoot, readManifestLines, resolveTcgAsset } from "./tcgAssetHelpers.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const OSFR_URL = process.env.OSFR_CLIENT_URL
    ?? "https://github.com/Open-Source-Free-Realms/OpenSourceFreeRealms/releases/download/v1.2/OSFR.Client.zip";
const zipPath = path.join(rootDir, "Emulator", "downloads", "OSFR.Client.zip");
const extractScript = path.join(__dirname, "scripts", "extract_tcg_selective.ps1");

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

async function downloadFile(url, dest) {
    ensureDir(path.dirname(dest));
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000_000) {
        console.log(`Using cached zip (${fs.statSync(dest).size} bytes): ${dest}`);
        return;
    }
    console.log(`Downloading ${url} ...`);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(dest, buffer);
    console.log(`Saved ${dest} (${buffer.length} bytes)`);
}

function verifyManifest() {
    const lines = readManifestLines();
    if (!lines.length) {
        console.warn("No manifest entries to verify.");
        return false;
    }
    let ok = 0;
    let missing = 0;
    let badCrc = 0;
    for (const entry of lines) {
        let data;
        try {
            data = getServedTcgBytes(entry.name);
        } catch {
            missing++;
            if (missing <= 5) {
                console.warn(`Missing: ${entry.name}`);
            }
            continue;
        }
        const actualCrc = crc32(data);
        if (actualCrc !== entry.crc || data.length !== entry.size) {
            badCrc++;
            if (badCrc <= 5) {
                console.warn(
                    `Manifest mismatch: ${entry.name} (have ${actualCrc}/${data.length}, want ${entry.crc}/${entry.size})`
                );
            }
        } else {
            ok++;
        }
    }
    console.log(`Manifest verify: ${ok} ok, ${missing} missing, ${badCrc} crc mismatch`);
    return missing === 0 && badCrc === 0;
}

function getServedTcgBytes(entryName) {
    const lowerName = entryName.toLowerCase();
    if (lowerName === "readme.txt") {
        return Buffer.alloc(0);
    }

    const withoutZ = entryName.replace(/\.z$/i, "");
    let fullPath;
    if (lowerName === "tradingcardassets.txt.z") {
        fullPath = path.join(clientRoot, "Resources", "TradingCardAssets.txt");
    } else {
        fullPath = resolveTcgAsset(entryName);
    }

    if (!fullPath || !fs.existsSync(fullPath)) {
        throw new Error(`Cannot resolve TCG manifest entry: ${entryName}`);
    }

    const data = fs.readFileSync(fullPath);
    return entryName.toLowerCase().endsWith(".z") ? zlib.deflateSync(data) : data;
}

function rewriteManifestForLocalServer() {
    const lines = readManifestLines();
    if (!lines.length) {
        throw new Error("Cannot rewrite TCG manifest: no entries found.");
    }

    const rewritten = lines.map((entry) => {
        const data = getServedTcgBytes(entry.name);
        return `${entry.name},${crc32(data)},${data.length}`;
    });

    const manifestPath = path.join(tcgRoot, "AssetsTcg_manifest.txt");
    fs.writeFileSync(manifestPath, `${rewritten.join("\r\n")}\r\n`);
    console.log(`Rewrote ${manifestPath} for locally served TCG assets.`);
}

function extractTcgFromZip() {
    ensureDir(tcgRoot);
    console.log(`Extracting tcg/ from zip into ${tcgRoot} ...`);
    execFileSync(
        "powershell.exe",
        [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            extractScript,
            "-ZipPath",
            zipPath,
            "-DestRoot",
            tcgRoot
        ],
        { stdio: "inherit" }
    );
}

async function main() {
    await downloadFile(OSFR_URL, zipPath);
    extractTcgFromZip();

    const exportManifestScript = path.join(__dirname, "scripts", "export_osfr_tcg_manifest.ps1");
    execFileSync(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", exportManifestScript],
        { stdio: "inherit" }
    );
    rewriteManifestForLocalServer();

    const cardsPath = path.join(tcgRoot, "cards.rcc");
    const dllPath = path.join(tcgRoot, "FreeRealmsTCG.dll");
    if (!fs.existsSync(cardsPath) || !fs.existsSync(dllPath)) {
        throw new Error(
            `TCG extract incomplete. Expected cards.rcc and FreeRealmsTCG.dll under ${tcgRoot}`
        );
    }

    console.log(`cards.rcc: ${fs.statSync(cardsPath).size} bytes`);
    console.log(`FreeRealmsTCG.dll: ${fs.statSync(dllPath).size} bytes`);

    const manifestOk = verifyManifest();
    if (!manifestOk) {
        console.warn(
            "Some manifest entries differ from OSFR loose files; the pack file AssetsTcgW_000.pack may be used at runtime."
        );
    }
    console.log("TCG extract completed successfully.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
