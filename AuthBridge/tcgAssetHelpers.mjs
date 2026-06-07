import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

export const tcgRoot = path.join(rootDir, "Servers", "Kaine's Server", "Client", "tcg");
export const clientRoot = path.join(rootDir, "Servers", "Kaine's Server", "Client");
export const tcgCacheDir = path.join(rootDir, "Emulator", "tcg_cache");
const diagnosticsLogDir = path.join(rootDir, "Emulator", "Logs");

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[i] = c >>> 0;
}

export function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

export function encodeFreeRealmsZ(data) {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(0xa1b2c3d4, 0);
    header.writeUInt32BE(data.length >>> 0, 4);
    return Buffer.concat([header, zlib.deflateSync(data)]);
}

export function safeTcgPath(relativePath) {
    const normalized = path.normalize(relativePath).replace(/^([/\\])+/, "");
    const fullPath = path.join(tcgRoot, normalized);
    const relative = path.relative(tcgRoot, fullPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return null;
    }
    return fullPath;
}

export function resolveTcgAsset(relativePath) {
    let normalized = path.normalize(relativePath).replace(/^([/\\])+/, "");
    if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
        return null;
    }

    normalized = normalized.replace(/^tcg[/\\]/i, "");
    const withoutZ = normalized.replace(/\.z$/i, "");
    const baseName = path.basename(withoutZ);
    const searchNames = [...new Set([withoutZ, baseName].filter(Boolean))];
    const candidates = searchNames.flatMap((name) => [
        name,
        path.join("data", name),
        path.join("data", "archetypes", name),
        path.join("data", "collections", name),
        path.join("data", "tutorial", name),
        path.join("locale", name),
        path.join("..", "Resources", name)
    ]);

    for (const candidate of candidates) {
        const fullPath = safeTcgPath(candidate);
        if (fullPath && fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
            return fullPath;
        }
    }

    for (const name of searchNames) {
        const resourcePath = path.join(clientRoot, "Resources", name);
        if (fs.existsSync(resourcePath) && fs.statSync(resourcePath).isFile()) {
            return resourcePath;
        }
    }

    const cachedPath = path.join(tcgCacheDir, normalized);
    if (fs.existsSync(cachedPath) && fs.statSync(cachedPath).isFile()) {
        return cachedPath;
    }

    const cachedWithoutZ = path.join(tcgCacheDir, withoutZ);
    if (fs.existsSync(cachedWithoutZ) && fs.statSync(cachedWithoutZ).isFile()) {
        return cachedWithoutZ;
    }

    return null;
}

export function readManifestLines() {
    const manifestPath = path.join(tcgRoot, "AssetsTcg_manifest.txt");
    if (!fs.existsSync(manifestPath)) {
        return [];
    }
    return fs.readFileSync(manifestPath, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const [name, crc, size] = line.split(",");
            return { name, crc: Number(crc), size: Number(size) };
        });
}

export function sendDeflatedFile(res, fullPath) {
	fs.readFile(fullPath, (err, data) => {
		if (err) {
			writeMinigameDiagnostic("WARN", "tcg-asset-read-failed", {
				path: fullPath,
				error: err.message
			});
			return res.sendStatus(404);
		}
		res.type("application/octet-stream").send(zlib.deflateSync(data));
	});
}

export function writeMinigameDiagnostic(level, eventName, fields = {}, handler = "AuthBridgeTcgAssets") {
	try {
		fs.mkdirSync(diagnosticsLogDir, { recursive: true });
		const now = new Date();
		const date = localDateStamp(now);
		const fieldText = Object.entries(fields)
			.map(([name, value]) => `${cleanDiagnosticValue(name)}=${cleanDiagnosticValue(String(value ?? ""))}`)
			.join("|");
		const line = `${localTimestamp(now)}|${level}|MINIGAME_DIAG|event=${cleanDiagnosticValue(eventName)}|handler=${cleanDiagnosticValue(handler)}|${fieldText}`;
		fs.appendFileSync(path.join(diagnosticsLogDir, `MinigameDiagnostics-${date}.log`), `${line}\n`);
	} catch {
		// Diagnostics must never break asset serving.
	}
}

function localDateStamp(date) {
	return [
		date.getFullYear(),
		pad2(date.getMonth() + 1),
		pad2(date.getDate())
	].join("-");
}

function localTimestamp(date) {
	return `${localDateStamp(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

function pad2(value) {
	return String(value).padStart(2, "0");
}

function cleanDiagnosticValue(value) {
	return String(value)
		.replace(/[|\r\n]/g, " ")
		.slice(0, 1024)
		.trim();
}

export function registerTcgRoutes(app, options = {}) {
    const { includeRootAliases = false } = options;
    const prefixPattern = includeRootAliases ? /^(?:tcg\/)?/i : /^tcg\//i;

    app.get([
        "/tcg/AssetsTcg_manifest.txt",
        "/tcg/manifest.txt",
        "/tcg/manifest",
        ...(includeRootAliases ? ["/AssetsTcg_manifest.txt", "/manifest.txt", "/manifest"] : [])
    ], (req, res) => {
        const manifestPath = path.join(tcgRoot, "AssetsTcg_manifest.txt");
        fs.readFile(manifestPath, (err, data) => {
            if (err) return res.sendStatus(404);
            res.type("text/plain").send(data);
        });
    });

    app.get([
        "/tcg/AssetsTcg_manifest.crc",
        "/tcg/AssetsTcg_manifest.txt.crc",
        "/tcg/AssetsTcg_manifest_crc",
        "/tcg/AssetsTcg_manifest.txt_crc",
        "/tcg/manifest.crc",
        "/tcg/manifest.txt.crc",
        "/tcg/manifest_crc",
        "/tcg/manifest.txt_crc",
        ...(includeRootAliases ? [
            "/AssetsTcg_manifest.crc",
            "/AssetsTcg_manifest.txt.crc",
            "/AssetsTcg_manifest_crc",
            "/AssetsTcg_manifest.txt_crc",
            "/manifest.crc",
            "/manifest.txt.crc",
            "/manifest_crc",
            "/manifest.txt_crc"
        ] : [])
    ], (req, res) => {
        const manifestPath = path.join(tcgRoot, "AssetsTcg_manifest.txt");
        fs.readFile(manifestPath, (err, data) => {
            if (err) return res.sendStatus(404);
            res.type("text/plain").send(String(crc32(data)));
        });
    });

    app.get([
        "/tcg/AssetsTcg_manifest.txt.z",
        "/tcg/manifest.txt.z",
        "/tcg/manifest.z",
        ...(includeRootAliases ? ["/AssetsTcg_manifest.txt.z", "/manifest.txt.z", "/manifest.z"] : [])
    ], (req, res) => {
        const manifestPath = path.join(tcgRoot, "AssetsTcg_manifest.txt");
        fs.readFile(manifestPath, (err, data) => {
            if (err) return res.sendStatus(404);
            res.type("application/octet-stream").send(zlib.deflateSync(data));
        });
    });

    app.get(/^\/tcg\/(.+\.z)$/i, (req, res) => {
        const relative = req.params[0];
        if (relative.toLowerCase() === "readme.txt.z") {
            res.type("application/octet-stream").send(zlib.deflateSync(Buffer.alloc(0)));
            return;
        }
        if (relative.toLowerCase() === "tradingcardassets.txt.z") {
            const tradingCardAssetsPath = path.join(clientRoot, "Resources", "TradingCardAssets.txt");
            return sendDeflatedFile(res, tradingCardAssetsPath);
        }
		const fullPath = resolveTcgAsset(relative);
		if (!fullPath) {
			writeMinigameDiagnostic("WARN", "tcg-asset-missing", {
				request: `/tcg/${relative}`,
				route: "z"
			});
			return res.sendStatus(404);
		}
		sendDeflatedFile(res, fullPath);
	});

    if (includeRootAliases) {
        app.get(/^\/(.+\.z)$/i, (req, res) => {
            const relative = req.params[0];
            if (relative.toLowerCase().endsWith(".z")) {
				const fullPath = resolveTcgAsset(relative);
				if (!fullPath) {
					writeMinigameDiagnostic("WARN", "tcg-asset-missing", {
						request: `/${relative}`,
						route: "root-z"
					});
					return res.sendStatus(404);
				}
				return sendDeflatedFile(res, fullPath);
			}
            res.sendStatus(404);
        });
    }

    app.get(/^\/tcg\/(.+\.pack)$/i, (req, res) => {
		const fullPath = resolveTcgAsset(req.params[0]);
		if (!fullPath) {
			writeMinigameDiagnostic("WARN", "tcg-asset-missing", {
				request: `/tcg/${req.params[0]}`,
				route: "pack"
			});
			return res.sendStatus(404);
		}
		res.sendFile(fullPath);
	});

    app.get(/^\/tcg\/(.+)$/i, (req, res) => {
        const relative = req.params[0];
        if (relative.toLowerCase() === "readme.txt") {
            res.type("text/plain").send("");
            return;
		}
		const fullPath = resolveTcgAsset(relative);
		if (!fullPath) {
			writeMinigameDiagnostic("WARN", "tcg-asset-missing", {
				request: `/tcg/${relative}`,
				route: "file"
			});
			return res.sendStatus(404);
		}
		res.sendFile(fullPath);
	});
}
