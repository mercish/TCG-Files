import express from "express";
import sqlite3pkg from "sqlite3";
import fs from "fs";
import https from "https";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "url";
import {
    registerTcgRoutes,
    resolveTcgAsset,
    tcgRoot,
    clientRoot as tcgClientRoot,
    writeMinigameDiagnostic
} from "./tcgAssetHelpers.mjs";

const app = express();
const port = Number(process.env.AUTHBRIDGE_PORT ?? 3000);
const httpsPort = Number(process.env.AUTHBRIDGE_HTTPS_PORT ?? 0);
const httpsPfxPath = process.env.AUTHBRIDGE_HTTPS_PFX_PATH ?? "";
const httpsPfxPassphrase = process.env.AUTHBRIDGE_HTTPS_PFX_PASSWORD ?? "";
const publicBaseUrl = (process.env.AUTHBRIDGE_PUBLIC_URL ?? `http://127.0.0.1:${port}`).replace(/\/$/, "");
const launcherBridgeBaseUrl = (process.env.AUTHBRIDGE_LAUNCHER_URL ?? process.env.LOCAL_AUTHBRIDGE_URL ?? `http://127.0.0.1:${port}`).replace(/\/$/, "");
const remoteLoginUrl = process.env.AUTHBRIDGE_REMOTE_LOGIN_URL ?? "https://raisingkaines.com/login";
const remoteSiteUrl = remoteLoginUrl.replace(/\/login\/?$/i, "");
const tcgBaseUrl = (process.env.TCG_PUBLIC_URL ?? remoteSiteUrl).replace(/\/$/, "");
const gameAssetClientBaseUrl = (process.env.GAME_ASSET_CLIENT_BASE_URL ?? process.env.AUTHBRIDGE_GAME_ASSET_URL ?? `http://127.0.0.1:${port}`).replace(/\/$/, "");
const tcgClientBaseUrl = (process.env.TCG_CLIENT_BASE_URL ?? process.env.AUTHBRIDGE_TCG_URL ?? tcgBaseUrl).replace(/\/$/, "");
const publicGameLoginServer = process.env.PUBLIC_GAME_LOGIN_SERVER ?? process.env.PUBLIC_LOGIN_SERVER ?? "72.68.27.46:20042";
const localGameLoginServer = process.env.LOCAL_GAME_LOGIN_SERVER ?? process.env.LOCAL_LOGIN_SERVER ?? "127.0.0.1:20042";
const enableGameIndirectAssets = String(process.env.ENABLE_GAME_INDIRECT_ASSETS ?? "true").toLowerCase() === "true";
const enableKaineNativeLaunchCompat = envFlag("ENABLE_KAINE_NATIVE_LAUNCH_COMPAT", true);
const launchDelayMs = Number(process.env.AUTHBRIDGE_LAUNCH_DELAY_MS ?? process.env.LAUNCH_DELAY_MS ?? 1500);
const nativeLaunchGuid = firstNonEmpty(process.env.OSFR_NATIVE_LAUNCH_GUID, process.env.OSFR_LAUNCH_GUID);
const nativeLaunchGuidByUsername = parseLaunchGuidMap(process.env.OSFR_NATIVE_LAUNCH_GUID_BY_USERNAME ?? process.env.OSFR_LAUNCH_GUID_BY_USERNAME ?? "");
const nativeLaunchGuidByCharacter = parseLaunchGuidMap(process.env.OSFR_NATIVE_LAUNCH_GUID_BY_CHARACTER ?? process.env.OSFR_LAUNCH_GUID_BY_CHARACTER ?? "");
if (enableKaineNativeLaunchCompat && !nativeLaunchGuidByUsername.has("kaineparker")) {
    nativeLaunchGuidByUsername.set("kaineparker", "225");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const clientRoot = tcgClientRoot;
const osfrExtractClientRoot = path.join(rootDir, "Emulator", "downloads", "osfr_client_extract", "OSFR Client");
const assetPackRoots = [clientRoot, osfrExtractClientRoot]
    .filter((root, index, roots) => fs.existsSync(root) && roots.findIndex((candidate) => path.resolve(candidate).toLowerCase() === path.resolve(root).toLowerCase()) === index);
const assetManifestPath = path.join(clientRoot, "Assets_manifest.txt");
const assetManifestAliases = [
    {
        name: "undefined",
        source: "undefined.dds",
        crc: 904091205,
        size: 16512,
        reason: "minigame-placeholder-image"
    }
];
const assetManifestOverrides = new Map([
    ["hsg_chair_throne_01.dds.z", { crc: 904091205, size: 6816, source: "undefined.dds.z" }],
    ["hsg_pots_01.dds.z", { crc: 904091205, size: 6816, source: "undefined.dds.z" }],
    ["hsg_castle_interior_pillow_01.cdt.z", { crc: 141006421, size: 3906, source: "cave_boulder_03.cdt.z" }],
    ["hsg_castle_interior_pillow_01_lod0.dme.z", { crc: 2998498438, size: 5152, source: "freestyle_fairy_f_feet_closedtoesandals.dme.z" }],
    ["hsg_pots_01_lod0.dme.z", { crc: 2998498438, size: 5152, source: "freestyle_fairy_f_feet_closedtoesandals.dme.z" }],
    ["brys_tournament_detail.dds.z", { crc: 1460300858, size: 131754, source: "treasure_wars_detail.dds.z" }],
    ["brys_tournament_thumb.dds.z", { crc: 1460300858, size: 131754, source: "treasure_wars_detail.dds.z" }],
    ["tcg_tutorial_detail.dds.z", { crc: 1460300858, size: 131754, source: "treasure_wars_detail.dds.z" }],
    ["tcg_tutorial_thumb.dds.z", { crc: 1460300858, size: 131754, source: "treasure_wars_detail.dds.z" }],
    ["treasure_wars_thumb.dds.z", { crc: 1460300858, size: 131754, source: "treasure_wars_detail.dds.z" }],
    ["brys_trick_detail.dds.z", { crc: 1636827689, size: 92910, source: "maples_trick_detail.dds.z" }],
    ["brys_trick_thumb.dds.z", { crc: 1636827689, size: 92910, source: "maples_trick_detail.dds.z" }],
    ["maples_trick_thumb.dds.z", { crc: 1636827689, size: 92910, source: "maples_trick_detail.dds.z" }],
    ["tcg_lobby_detail.dds.z", { crc: 1636827689, size: 92910, source: "maples_trick_detail.dds.z" }],
    ["tcg_lobby_thumb.dds.z", { crc: 1636827689, size: 92910, source: "maples_trick_detail.dds.z" }]
]);
const emptyAssetListFiles = new Set([
    "smalluiassets.txt",
    "uiassets.txt"
]);
const missingAssetFallbacks = [
    {
        pattern: /\.dds$/i,
        source: "undefined.dds",
        reason: "missing-texture-placeholder"
    },
    {
        pattern: /\.cdt$/i,
        source: "cave_boulder_03.cdt",
        reason: "missing-collision-placeholder"
    },
    {
        pattern: /\.dme$/i,
        source: "freestyle_fairy_f_feet_closedtoesandals.dme",
        reason: "missing-model-placeholder"
    }
];
const packedAssetOverrides = [
    {
        name: "undefined.dds",
        packPath: path.join(clientRoot, "Assets_004.pack"),
        offset: 49716548,
        size: 16512,
        crc: 904091205
    }
];
const placeholderPackedAsset = {
    crc: 904091205,
    size: 16512
};
const minigameArtFallbacks = new Map([
    ["brys_tournament_detail.dds", { source: "treasure_wars_detail.dds", reason: "tcg-minigame-art-placeholder-in-pack" }],
    ["brys_tournament_thumb.dds", { source: "treasure_wars_detail.dds", reason: "tcg-minigame-thumb-placeholder-in-pack" }],
    ["brys_trick_detail.dds", { source: "maples_trick_detail.dds", reason: "tcg-minigame-art-placeholder-in-pack" }],
    ["brys_trick_thumb.dds", { source: "maples_trick_detail.dds", reason: "tcg-minigame-thumb-placeholder-in-pack" }],
    ["maples_trick_thumb.dds", { source: "maples_trick_detail.dds", reason: "tcg-minigame-thumb-missing-from-pack" }],
    ["tcg_lobby_detail.dds", { source: "maples_trick_detail.dds", reason: "tcg-minigame-art-placeholder-in-pack" }],
    ["tcg_lobby_thumb.dds", { source: "maples_trick_detail.dds", reason: "tcg-minigame-thumb-placeholder-in-pack" }],
    ["tcg_tutorial_detail.dds", { source: "treasure_wars_detail.dds", reason: "tcg-minigame-art-placeholder-in-pack" }],
    ["tcg_tutorial_thumb.dds", { source: "treasure_wars_detail.dds", reason: "tcg-minigame-thumb-placeholder-in-pack" }],
    ["treasure_wars_thumb.dds", { source: "treasure_wars_detail.dds", reason: "tcg-minigame-thumb-placeholder-in-pack" }]
]);
const generatedDdsAssetDefinitions = new Map([
    ["ui_minigame_status_bottompanel.dds", { width: 512, height: 128, crc: 2630662787, color: [31, 38, 45, 230], accent: [85, 152, 167, 255] }],
    ["ui_minigame_status_desc_toppanel.dds", { width: 512, height: 96, crc: 2840377216, color: [34, 38, 47, 230], accent: [111, 140, 181, 255] }],
    ["ui_minigame_status_starcounter.dds", { width: 256, height: 32, crc: 3800463295, color: [48, 40, 28, 230], accent: [237, 185, 72, 255] }],
    ["ui_objective_completed.dds", { width: 128, height: 32, crc: 997356850, color: [25, 76, 54, 230], accent: [82, 203, 126, 255] }],
    ["ui_objective_failed.dds", { width: 128, height: 32, crc: 544657703, color: [92, 35, 38, 230], accent: [219, 91, 78, 255] }],
    ["ui_minigame_status_desc_rewards_background.dds", { width: 256, height: 64, crc: 1531824551, color: [36, 43, 50, 230], accent: [93, 166, 157, 255] }],
    ["ui_minigame_status_reward64.dds", { width: 64, height: 64, crc: 4290835508, color: [42, 51, 57, 230], accent: [222, 172, 78, 255] }],
    ["ui_minigame_status_reward128.dds", { width: 128, height: 128, crc: 1568432760, color: [42, 51, 57, 230], accent: [222, 172, 78, 255] }]
]);
const generatedDdsAssetCache = new Map();

const sqlite3 = sqlite3pkg.verbose();
const dbFile = path.join(rootDir, "Emulator", "database", "sanctuary.db");
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) {
        console.error("Failed to open database:", dbFile, err);
    } else {
        console.log("Connected to DB at:", dbFile);
    }
});

function runDb(sql, params = []) {
    return new Promise((resolve) => {
        db.run(sql, params, function onRun(err) {
            resolve({
                err,
                changes: this?.changes ?? 0
            });
        });
    });
}

function getDb(sql, params = []) {
    return new Promise((resolve) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                console.error("Local DB query error:", err);
                resolve(null);
            } else {
                resolve(row ?? null);
            }
        });
    });
}

async function findLocalUser(username) {
    return getDb("SELECT * FROM Users WHERE lower(Username) = lower(?)", [username]);
}

async function findFirstCharacterForUser(userId) {
    if (userId == null) {
        return null;
    }
    return getDb("SELECT * FROM Characters WHERE UserId = ? ORDER BY Id LIMIT 1", [userId]);
}

async function findMostRecentCharacterForUser(userId) {
    if (userId == null) {
        return null;
    }
    return getDb(
        "SELECT * FROM Characters WHERE UserId = ? ORDER BY CASE WHEN LastLogin IS NULL THEN 1 ELSE 0 END, LastLogin DESC, Id LIMIT 1",
        [userId]
    );
}

async function findCharacterForUserById(userId, characterId) {
    const id = Number(characterId);
    if (userId == null || !Number.isSafeInteger(id) || id <= 0) {
        return null;
    }
    return getDb("SELECT * FROM Characters WHERE UserId = ? AND Id = ? LIMIT 1", [userId, id]);
}

async function findCharacterForUserByName(userId, name) {
    const normalized = normalizeCharacterName(name);
    if (userId == null || !normalized) {
        return null;
    }
    return getDb(
        "SELECT * FROM Characters WHERE UserId = ? AND lower(trim(COALESCE(FirstName, '') || ' ' || COALESCE(LastName, ''))) = ? LIMIT 1",
        [userId, normalized]
    );
}

function normalizeCharacterName(value) {
    return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

async function syncLocalLoginSession(username, sessionId) {
    const sessionCreated = new Date().toISOString();
    const result = await runDb(
        "UPDATE Users SET Session = ?, SessionCreated = ? WHERE lower(Username) = lower(?)",
        [sessionId, sessionCreated, username]
    );

    if (result.err) {
        logAssetDiagnostic("ERROR", "local-login-session-sync-failed", {
            usernameProvided: true,
            sessionId: "present",
            error: result.err.message
        });
        return false;
    }

    logAssetDiagnostic(result.changes > 0 ? "INFO" : "WARN", "local-login-session-sync", {
        usernameProvided: true,
        sessionId: "present",
        userMatched: result.changes > 0,
        changes: result.changes
    });
    return result.changes > 0;
}

function normalizeGuidForDatabase(value) {
    const hex = normalizeGuidN(value);
    if (!/^[0-9a-f]{32}$/.test(hex)) {
        return "";
    }

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeGuidN(value) {
    return String(value ?? "").trim().replace(/[{}-]/g, "").toLowerCase();
}

function createNativeSessionId(preferred = "") {
    const normalized = normalizeGuidN(preferred);
    if (/^[0-9a-f]{32}$/.test(normalized)) {
        return normalized;
    }

    return crypto.randomBytes(16).toString("hex");
}

async function syncLocalCharacterTicket(character, ticket, context = {}) {
    const characterId = Number(character?.Id ?? character?.id);
    const userId = Number(character?.UserId ?? character?.userId);
    const dbTicket = normalizeGuidForDatabase(ticket);
    if (!Number.isSafeInteger(characterId) || characterId <= 0 || !dbTicket) {
        logAssetDiagnostic("ERROR", "local-character-ticket-sync-invalid", {
            ...context,
            characterId: characterId || "",
            ticket: ticket ? "present" : "missing",
            ticketFormat: dbTicket ? "guid-d" : "invalid"
        });
        return false;
    }

    const result = Number.isSafeInteger(userId) && userId > 0
        ? await runDb("UPDATE Characters SET Ticket = ? WHERE Id = ? AND UserId = ?", [dbTicket, characterId, userId])
        : await runDb("UPDATE Characters SET Ticket = ? WHERE Id = ?", [dbTicket, characterId]);

    if (result.err) {
        logAssetDiagnostic("ERROR", "local-character-ticket-sync-failed", {
            ...context,
            characterId,
            ticket: "present",
            ticketFormat: "guid-d",
            error: result.err.message
        });
        return false;
    }

    logAssetDiagnostic(result.changes > 0 ? "INFO" : "WARN", "local-character-ticket-sync", {
        ...context,
        characterId,
        ticket: "present",
        ticketFormat: "guid-d",
        characterMatched: result.changes > 0,
        changes: result.changes
    });
    return result.changes > 0;
}

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[i] = c >>> 0;
}

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function createGeneratedDdsAsset(name, definition) {
    const base = createGeneratedDds32(definition.width, definition.height, definition.color, definition.accent);
    const data = appendCrc32Patch(base, definition.crc);
    const actualCrc = crc32(data);
    if (actualCrc !== definition.crc) {
        throw new Error(`generated DDS CRC mismatch for ${name}: ${actualCrc}`);
    }
    return data;
}

function createGeneratedDds32(width, height, color, accent) {
    const header = Buffer.alloc(128);
    header.write("DDS ", 0, "ascii");
    header.writeUInt32LE(124, 4);
    header.writeUInt32LE(0x100f, 8);
    header.writeUInt32LE(height, 12);
    header.writeUInt32LE(width, 16);
    header.writeUInt32LE(width * 4, 20);
    header.writeUInt32LE(32, 76);
    header.writeUInt32LE(0x41, 80);
    header.writeUInt32LE(32, 88);
    header.writeUInt32LE(0x00ff0000, 92);
    header.writeUInt32LE(0x0000ff00, 96);
    header.writeUInt32LE(0x000000ff, 100);
    header.writeUInt32LE(0xff000000, 104);
    header.writeUInt32LE(0x1000, 108);

    const pixels = Buffer.alloc(width * height * 4);
    const [r, g, b, a] = color;
    const [ar, ag, ab, aa] = accent;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const edge = x < 2 || y < 2 || x >= width - 2 || y >= height - 2;
            const stripe = ((x + y) % 31) === 0;
            const offset = (y * width + x) * 4;
            pixels[offset] = edge || stripe ? ab : b;
            pixels[offset + 1] = edge || stripe ? ag : g;
            pixels[offset + 2] = edge || stripe ? ar : r;
            pixels[offset + 3] = edge ? aa : a;
        }
    }

    return Buffer.concat([header, pixels]);
}

function appendCrc32Patch(data, targetCrc) {
    const zeroPatch = Buffer.alloc(4);
    const zeroCrc = crc32(Buffer.concat([data, zeroPatch]));
    const columns = [];
    for (let bit = 0; bit < 32; bit++) {
        const patch = Buffer.alloc(4);
        patch[bit >> 3] = 1 << (bit & 7);
        columns.push(crc32(Buffer.concat([data, patch])) ^ zeroCrc);
    }

    const basis = new Uint32Array(32);
    const coefficients = Array(32).fill(0n);
    for (let bit = 0; bit < 32; bit++) {
        let vector = columns[bit] >>> 0;
        let mask = 1n << BigInt(bit);
        while (vector) {
            const pivot = 31 - Math.clz32(vector);
            if (!basis[pivot]) {
                basis[pivot] = vector;
                coefficients[pivot] = mask;
                break;
            }
            vector = (vector ^ basis[pivot]) >>> 0;
            mask ^= coefficients[pivot];
        }
    }

    let remainder = (targetCrc ^ zeroCrc) >>> 0;
    let solution = 0n;
    while (remainder) {
        const pivot = 31 - Math.clz32(remainder);
        if (!basis[pivot]) {
            throw new Error("unable to solve CRC patch");
        }
        remainder = (remainder ^ basis[pivot]) >>> 0;
        solution ^= coefficients[pivot];
    }

    const patch = Buffer.alloc(4);
    for (let bit = 0; bit < 32; bit++) {
        if (((solution >> BigInt(bit)) & 1n) !== 0n) {
            patch[bit >> 3] |= 1 << (bit & 7);
        }
    }
    return Buffer.concat([data, patch]);
}

function encodeFreeRealmsZ(data) {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(0xa1b2c3d4, 0);
    header.writeUInt32BE(data.length >>> 0, 4);
    return Buffer.concat([header, zlib.deflateSync(data)]);
}

function safeClientPath(relativePath) {
    const normalized = path.normalize(relativePath).replace(/^([/\\])+/, "");
    const fullPath = path.join(clientRoot, normalized);
    const relative = path.relative(clientRoot, fullPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return null;
    }
    return fullPath;
}

function envFlag(name, fallback = false) {
    const raw = process.env[name];
    if (raw == null || raw === "") {
        return Boolean(fallback);
    }
    return !["0", "false", "no", "off"].includes(String(raw).trim().toLowerCase());
}

function firstNonEmpty(...values) {
    for (const value of values) {
        const text = String(value ?? "").trim();
        if (text) {
            return text;
        }
    }
    return "";
}

function normalizeMapKey(value) {
    return String(value ?? "").trim().toLowerCase();
}

function parseLaunchGuidMap(raw) {
    const map = new Map();
    for (const part of String(raw ?? "").split(/[;,]/)) {
        const trimmed = part.trim();
        if (!trimmed) {
            continue;
        }
        const index = trimmed.search(/[:=]/);
        if (index <= 0) {
            continue;
        }
        const key = normalizeMapKey(trimmed.slice(0, index));
        const value = trimmed.slice(index + 1).trim();
        if (key && value) {
            map.set(key, value);
        }
    }
    return map;
}

function logAssetDiagnostic(level, eventName, fields = {}) {
    writeMinigameDiagnostic(level, eventName, fields, "AuthBridgeAssetDelivery");
}

function encodeNativeCharacterGuid(characterId) {
    const id = Number(characterId);
    if (!Number.isSafeInteger(id) || id <= 0) {
        return "";
    }
    return String((id << 4) | 1);
}

function decodeNativeCharacterGuid(nativeGuid) {
    const guid = Number(nativeGuid);
    if (!Number.isSafeInteger(guid) || guid <= 0 || (guid & 0x0f) !== 1) {
        return null;
    }
    const id = guid >> 4;
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function resolveLaunchCharacterForUser(userId, sources = {}) {
    if (userId == null) {
        return { character: null, reason: "missing-user" };
    }

    const envHints = {
        characterId: process.env.OSFR_NATIVE_LAUNCH_CHARACTER_ID ?? process.env.OSFR_LAUNCH_CHARACTER_ID,
        nativeGuid: process.env.OSFR_NATIVE_LAUNCH_CHARACTER_GUID ?? process.env.OSFR_LAUNCH_CHARACTER_GUID,
        characterName: process.env.OSFR_NATIVE_LAUNCH_CHARACTER_NAME ?? process.env.OSFR_LAUNCH_CHARACTER_NAME
    };
    const payload = sources.payload ?? {};
    const request = sources.request ?? {};

    for (const key of ["characterId", "CharacterId", "selectedCharacterId", "SelectedCharacterId"]) {
        const character = await findCharacterForUserById(userId, envHints[key] ?? payload[key] ?? request[key]);
        if (character) {
            return { character, reason: `explicit-${key}` };
        }
    }

    for (const key of ["nativeGuid", "NativeGuid", "characterGuid", "CharacterGuid", "guid", "Guid"]) {
        const characterId = decodeNativeCharacterGuid(envHints[key] ?? payload[key] ?? request[key]);
        const character = await findCharacterForUserById(userId, characterId);
        if (character) {
            return { character, reason: `explicit-${key}` };
        }
    }

    for (const key of ["characterName", "CharacterName", "selectedCharacterName", "SelectedCharacterName", "character", "Character"]) {
        const character = await findCharacterForUserByName(userId, envHints[key] ?? payload[key] ?? request[key]);
        if (character) {
            return { character, reason: `explicit-${key}` };
        }
    }

    const recent = await findMostRecentCharacterForUser(userId);
    if (recent) {
        return { character: recent, reason: "last-login" };
    }

    return { character: await findFirstCharacterForUser(userId), reason: "first-character-fallback" };
}

function resolveNativeLaunchGuid(username, user, character) {
    const explicit = firstNonEmpty(character?.NativeGuid, character?.nativeGuid, character?.Guid, character?.guid);
    if (explicit) {
        return explicit;
    }

    for (const key of [character?.Id, character?.id]) {
        const mapped = nativeLaunchGuidByCharacter.get(normalizeMapKey(key));
        if (mapped) {
            return mapped;
        }
    }

    const encodedCharacterGuid = encodeNativeCharacterGuid(character?.Id ?? character?.id);
    if (encodedCharacterGuid) {
        return encodedCharacterGuid;
    }

    for (const key of [username, user?.Username, user?.username, user?.Id, user?.id]) {
        const mapped = nativeLaunchGuidByUsername.get(normalizeMapKey(key));
        if (mapped) {
            return mapped;
        }
    }

    return nativeLaunchGuid || "";
}

function buildNativeLaunchArguments(loginServer = localGameLoginServer, launch = {}) {
    const indirectEnabled = enableGameIndirectAssets ? "True" : "False";
    const args = [
        "inifile=ClientConfig.ini",
        `Server=${loginServer}`,
    ];
    if (launch.guid) {
        args.push(`Guid=${launch.guid}`);
    }
    if (launch.ticket) {
        args.push(`Ticket=${launch.ticket}`);
    }
    args.push(
        "AssetDelivery:DirectEnabled=True",
        `AssetDelivery:IndirectEnabled=${indirectEnabled}`,
        `AssetDelivery:IndirectServerAddress=${gameAssetClientBaseUrl}/assets`,
        `AssetDelivery:TcgServerAddress=${tcgClientBaseUrl}/tcg`,
        "Tcg.ActivityId=7",
        "Scg.ActivityId=7",
        "tcg_ignore_ticket=1"
    );
    return args.join(" ");
}

function sendAssetReadFailure(res, eventName, fields, err) {
    logAssetDiagnostic("WARN", eventName, {
        ...fields,
        error: err?.message ?? "not found"
    });
    return res.sendStatus(404);
}

function augmentAssetManifest(data) {
    let text = data.toString("utf8");
    const lines = text.split(/\r?\n/);
    let overridesApplied = 0;
    for (let i = 0; i < lines.length; i++) {
        const [name] = lines[i].split(",", 1);
        const override = assetManifestOverrides.get(name?.toLowerCase());
        if (override) {
            lines[i] = `${name},${override.crc},${override.size}`;
            overridesApplied++;
        }
    }
    for (const [name, override] of assetManifestOverrides) {
        if (!lines.some((line) => line.toLowerCase().startsWith(`${name},`))) {
            lines.push(`${name},${override.crc},${override.size}`);
            overridesApplied++;
        }
    }
    if (overridesApplied > 0) {
        logAssetDiagnostic("INFO", "asset-manifest-overrides-applied", {
            count: overridesApplied
        });
    }
    text = lines.join("\r\n");
    for (const alias of assetManifestAliases) {
        const linePrefix = `${alias.name},`;
        if (!text.split(/\r?\n/).some((line) => line.startsWith(linePrefix))) {
            if (!text.endsWith("\n")) {
                text += "\r\n";
            }
            text += `${alias.name},${alias.crc},${alias.size}\r\n`;
        }
    }
    return Buffer.from(text, "utf8");
}

function readAugmentedAssetManifest(callback) {
    fs.readFile(assetManifestPath, (err, data) => {
        if (err) {
            callback(err);
            return;
        }
        callback(null, augmentAssetManifest(data));
    });
}

function sendAugmentedAssetManifest(req, res, response) {
    readAugmentedAssetManifest((err, data) => {
        if (err) {
            return sendAssetReadFailure(res, "asset-manifest-read-failed", {
                request: req.path,
                path: assetManifestPath,
                response
            }, err);
        }
        const compressed = encodeFreeRealmsZ(data);
        logAssetDiagnostic("INFO", "asset-manifest-served", {
            request: req.path,
            response,
            compression: "freerealms-z",
            size: data.length,
            compressedSize: compressed.length,
            crc: crc32(data)
        });
        res.type("application/octet-stream").send(compressed);
    });
}

function sendPlainAssetManifest(req, res, response) {
    readAugmentedAssetManifest((err, data) => {
        if (err) {
            return sendAssetReadFailure(res, "asset-manifest-read-failed", {
                request: req.path,
                path: assetManifestPath,
                response
            }, err);
        }
        logAssetDiagnostic("INFO", "asset-manifest-served", {
            request: req.path,
            response,
            compression: "none",
            size: data.length,
            crc: crc32(data)
        });
        res
            .set("Cache-Control", "public, max-age=300, no-transform")
            .type("text/plain")
            .send(data);
    });
}

function sendDeflatedClientFile(res, fullPath, fields) {
    fs.readFile(fullPath, (err, data) => {
        if (err) {
            return sendAssetReadFailure(res, "asset-read-failed", fields, err);
        }
        res.type("application/octet-stream").send(encodeFreeRealmsZ(data));
    });
}

function isEmptyAssetListFile(assetName) {
    return emptyAssetListFiles.has(String(assetName ?? "").replace(/\\/g, "/").toLowerCase());
}

function sendEmptyAssetList(res, fields, compressed = false) {
    const data = Buffer.alloc(0);
    logAssetDiagnostic("INFO", "empty-asset-list-served", {
        ...fields,
        compression: compressed ? "freerealms-z" : "none",
        size: 0,
        crc: 0
    });
    if (compressed) {
        res.type("application/octet-stream").send(encodeFreeRealmsZ(data));
        return;
    }
    res
        .set("Cache-Control", "public, max-age=300, no-transform")
        .type("text/plain")
        .send(data);
}

function sendClientFile(req, res, fullPath, fields) {
    res.sendFile(fullPath, (err) => {
        if (!err) {
            return;
        }
        if (!res.headersSent) {
            sendAssetReadFailure(res, "asset-read-failed", fields, err);
        } else {
            logAssetDiagnostic("WARN", "asset-send-failed-after-headers", {
                ...fields,
                error: err.message
            });
        }
    });
}

let assetPackFiles = null;
let packedAssetIndex = null;
const packedAssetCache = new Map();

function getAssetPackFiles() {
    if (assetPackFiles) {
        return assetPackFiles;
    }

    const files = [];
    const collectPackFiles = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
            .sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                collectPackFiles(fullPath);
            } else if (/\.pack$/i.test(entry.name)) {
                files.push(fullPath);
            }
        }
    };

    for (const root of assetPackRoots) {
        collectPackFiles(root);
    }
    assetPackFiles = files;
    logAssetDiagnostic("INFO", "asset-pack-files-indexed", {
        count: assetPackFiles.length,
        roots: assetPackRoots.join(";")
    });
    return assetPackFiles;
}

function getPackedAssetIndex() {
    if (packedAssetIndex) {
        return packedAssetIndex;
    }

    packedAssetIndex = new Map();
    for (const packPath of getAssetPackFiles()) {
        indexAssetPack(packPath, packedAssetIndex);
    }

    logAssetDiagnostic("INFO", "asset-pack-index-built", {
        entries: packedAssetIndex.size,
        packs: getAssetPackFiles().length
    });
    return packedAssetIndex;
}

function indexAssetPack(packPath, index) {
    let fd;
    try {
        fd = fs.openSync(packPath, "r");
        const fileSize = fs.fstatSync(fd).size;

        let offset = 0;
        let indexed = 0;
        while (offset < fileSize) {
            const headerBuf = Buffer.alloc(8);
            const bytesRead = fs.readSync(fd, headerBuf, 0, 8, offset);
            if (bytesRead < 8) break;

            const nextOffset = headerBuf.readUInt32BE(0);
            const count = headerBuf.readUInt32BE(4);

            if (count <= 0) {
                if (nextOffset === 0) break;
                offset = nextOffset;
                continue;
            }

            const dirSize = Math.min(fileSize - offset, count * 80 + 128);
            const dirBuf = Buffer.alloc(dirSize);
            const dirBytesRead = fs.readSync(fd, dirBuf, 0, dirBuf.length, offset);

            let pos = 8;
            for (let i = 0; i < count; i++) {
                if (pos + 4 > dirBytesRead) break;
                const nameLength = dirBuf.readUInt32BE(pos);
                pos += 4;
                if (nameLength <= 0 || nameLength > 1024 || pos + nameLength + 12 > dirBytesRead) {
                    break;
                }
                const name = dirBuf.subarray(pos, pos + nameLength).toString("utf8");
                pos += nameLength;
                const fileOffset = dirBuf.readUInt32BE(pos);
                const fileSizeEntry = dirBuf.readUInt32BE(pos + 4);
                const crc = dirBuf.readUInt32BE(pos + 8);
                pos += 12;

                if (fileSizeEntry <= 0 || fileOffset <= 0 || fileOffset + fileSizeEntry > fileSize) {
                    continue;
                }

                const cacheKey = name.toLowerCase();
                if (!index.has(cacheKey)) {
                    index.set(cacheKey, {
                        name,
                        packPath,
                        offset: fileOffset,
                        size: fileSizeEntry,
                        crc
                    });
                    indexed++;
                }
            }

            if (nextOffset === 0) break;
            offset = nextOffset;
        }

        logAssetDiagnostic("INFO", "asset-pack-indexed", {
            pack: packPath,
            entries: indexed
        });
    } catch (err) {
        logAssetDiagnostic("WARN", "asset-pack-index-failed", {
            pack: packPath,
            error: err.message
        });
    } finally {
        if (fd !== undefined) {
            fs.closeSync(fd);
        }
    }
}

function findPackedAssetByExactName(assetName) {
    const cacheKey = assetName.toLowerCase();
    if (packedAssetCache.has(cacheKey)) {
        return packedAssetCache.get(cacheKey);
    }

    const indexed = getPackedAssetIndex().get(cacheKey) ?? null;
    if (indexed) {
        packedAssetCache.set(cacheKey, indexed);
        return indexed;
    }

    const override = packedAssetOverrides.find((entry) => entry.name.toLowerCase() === cacheKey) ?? null;
    if (override && fs.existsSync(override.packPath)) {
        const packSize = fs.statSync(override.packPath).size;
        if (override.offset > 0 && override.size > 0 && override.offset + override.size <= packSize) {
            packedAssetCache.set(cacheKey, override);
            return override;
        }
    }

    packedAssetCache.set(cacheKey, null);
    return null;
}

function isPlaceholderPackedAsset(entry) {
    return entry?.crc === placeholderPackedAsset.crc
        && entry?.size === placeholderPackedAsset.size
        && entry?.name?.toLowerCase() !== "undefined.dds";
}

function resolvePackedMinigameArtFallback(candidate, placeholderEntry) {
    const normalized = candidate.replace(/\\/g, "/").replace(/^\/+/, "");
    const baseName = path.posix.basename(normalized).toLowerCase();
    const fallback = minigameArtFallbacks.get(baseName);
    if (!fallback) {
        return null;
    }

    const fallbackEntry = findPackedAssetByExactName(fallback.source);
    if (!fallbackEntry || isPlaceholderPackedAsset(fallbackEntry)) {
        logAssetDiagnostic("WARN", "asset-minigame-art-fallback-missing", {
            asset: normalized,
            placeholderAsset: placeholderEntry?.name ?? "",
            fallback: fallback.source,
            reason: fallback.reason
        });
        return null;
    }

    return {
        requested: candidate,
        resolved: fallback.source,
        entry: fallbackEntry,
        fallbackSource: fallback.source,
        fallbackReason: fallback.reason,
        placeholderAsset: placeholderEntry?.name ?? ""
    };
}

function addPackedAssetCandidate(candidates, value) {
    if (!value) {
        return;
    }
    const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalized || normalized.startsWith("../") || normalized.includes("/../")) {
        return;
    }
    if (!candidates.includes(normalized)) {
        candidates.push(normalized);
    }
}

function packedAssetCandidates(relativePath) {
    const normalized = path.posix.normalize(relativePath.replace(/\\/g, "/")).replace(/^\/+/, "");
    const baseName = path.posix.basename(normalized);
    const compactNames = [normalized];
    if (baseName && baseName !== normalized) {
        compactNames.push(baseName);
    }

    const candidates = [];
    for (const name of compactNames) {
        const ext = path.posix.extname(name);
        if (!ext) {
            const alias = assetManifestAliases.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
            if (alias) {
                addPackedAssetCandidate(candidates, alias.source);
            }
            for (const suffix of [".dds", ".png", ".gfx", ".lst", ".swf"]) {
                addPackedAssetCandidate(candidates, `${name}${suffix}`);
            }
        }
        addPackedAssetCandidate(candidates, name);
    }
    return candidates;
}

function resolvePackedAsset(relativePath) {
    for (const candidate of packedAssetCandidates(relativePath)) {
        const entry = findPackedAssetByExactName(candidate);
        if (entry) {
            if (isPlaceholderPackedAsset(entry)) {
                const fallback = resolvePackedMinigameArtFallback(candidate, entry);
                if (fallback) {
                    return fallback;
                }
            }
            return {
                requested: relativePath,
                resolved: candidate,
                entry
            };
        }

        const fallback = resolvePackedMinigameArtFallback(candidate, null);
        if (fallback) {
            return fallback;
        }
    }
    return null;
}

function resolveMissingAssetFallback(relativePath) {
    const normalized = path.posix.normalize(relativePath.replace(/\\/g, "/")).replace(/^\/+/, "");
    const fallback = missingAssetFallbacks.find((entry) => entry.pattern.test(normalized));
    if (!fallback) {
        return null;
    }

    const packed = resolvePackedAsset(fallback.source);
    if (!packed) {
        logAssetDiagnostic("WARN", "asset-fallback-missing", {
            asset: normalized,
            fallback: fallback.source,
            reason: fallback.reason
        });
        return null;
    }

    return {
        ...packed,
        fallbackSource: fallback.source,
        fallbackReason: fallback.reason
    };
}

function readPackedAsset(entry) {
    const fd = fs.openSync(entry.packPath, "r");
    try {
        const data = Buffer.alloc(entry.size);
        fs.readSync(fd, data, 0, entry.size, entry.offset);
        return data;
    } finally {
        fs.closeSync(fd);
    }
}

function resolveGeneratedDdsAsset(relativePath) {
    const normalized = path.posix.normalize(relativePath.replace(/\\/g, "/")).replace(/^\/+/, "");
    const cacheKey = path.posix.basename(normalized).toLowerCase();
    const definition = generatedDdsAssetDefinitions.get(cacheKey);
    if (!definition) {
        return null;
    }

    if (!generatedDdsAssetCache.has(cacheKey)) {
        generatedDdsAssetCache.set(cacheKey, createGeneratedDdsAsset(cacheKey, definition));
    }

    return {
        requested: relativePath,
        resolved: cacheKey,
        data: generatedDdsAssetCache.get(cacheKey),
        crc: definition.crc
    };
}

function sendGeneratedDdsAsset(res, generated, fields, shouldDeflate) {
    logAssetDiagnostic("WARN", "asset-generated-dds-served", {
        ...fields,
        resolvedAsset: generated.resolved,
        size: generated.data.length,
        crc: generated.crc,
        deflated: shouldDeflate,
        reason: "original-status-dds-missing"
    });

    res.type("application/octet-stream").send(shouldDeflate ? encodeFreeRealmsZ(generated.data) : generated.data);
}

function sendPackedAsset(res, packed, fields, shouldDeflate) {
    let data;
    try {
        data = readPackedAsset(packed.entry);
    } catch (err) {
        return sendAssetReadFailure(res, "asset-pack-read-failed", {
            ...fields,
            resolvedAsset: packed.resolved,
            pack: packed.entry.packPath,
            offset: packed.entry.offset,
            size: packed.entry.size
        }, err);
    }

    logAssetDiagnostic("INFO", "asset-pack-served", {
        ...fields,
        resolvedAsset: packed.resolved,
        fallbackSource: packed.fallbackSource ?? "",
        fallbackReason: packed.fallbackReason ?? "",
        placeholderAsset: packed.placeholderAsset ?? "",
        pack: packed.entry.packPath,
        offset: packed.entry.offset,
        size: packed.entry.size,
        crc: packed.entry.crc,
        deflated: shouldDeflate
    });

    res.type("application/octet-stream").send(shouldDeflate ? encodeFreeRealmsZ(data) : data);
}

app.use(express.json());

app.get("/", (req, res) => {
    res.send("AuthBridge online");
});

app.get(["/servermanifest.xml", "/login/servermanifest.xml", "/client/servermanifest.xml"], (req, res) => {
    res.sendFile("manifests/servermanifest.xml", { root: __dirname, headers: { "Content-Type": "text/xml; charset=utf-8" } });
});

app.get(["/servermanifest", "/login/servermanifest", "/client/servermanifest"], (req, res) => {
    res.sendFile("manifests/servermanifest.xml", { root: __dirname, headers: { "Content-Type": "text/xml; charset=utf-8" } });
});

app.get(["/clientmanifest.xml", "/login/clientmanifest.xml", "/client/clientmanifest.xml"], (req, res) => {
    res.sendFile("manifests/clientmanifest.xml", { root: __dirname, headers: { "Content-Type": "text/xml; charset=utf-8" } });
});

app.get(["/clientmanifest", "/login/clientmanifest", "/client/clientmanifest"], (req, res) => {
    res.sendFile("manifests/clientmanifest.xml", { root: __dirname, headers: { "Content-Type": "text/xml; charset=utf-8" } });
});

app.get(["/server/servermanifest.xml", "/server/login/servermanifest.xml"], (req, res) => {
    res.type("text/xml; charset=utf-8").send(`<?xml version="1.0" encoding="utf-8"?>
<ServerManifest version="1">
  <Name>Kaine's Online Server</Name>
  <Description>Welcome!</Description>
  <LoginServer>${publicGameLoginServer}</LoginServer>
  <LoginApiUrl>${remoteLoginUrl}</LoginApiUrl>
  <RegisterUrl>${remoteSiteUrl}/register</RegisterUrl>
</ServerManifest>
`);
});

app.get(["/server/servermanifest", "/server/login/servermanifest"], (req, res) => {
    res.redirect(302, "/server/servermanifest.xml");
});

app.get(["/server/clientmanifest.xml", "/server/login/clientmanifest.xml"], (req, res) => {
    res.sendFile("manifests/clientmanifest.xml", { root: __dirname, headers: { "Content-Type": "text/xml; charset=utf-8" } });
});

app.get(["/server/clientmanifest", "/server/login/clientmanifest"], (req, res) => {
    res.redirect(302, "/server/clientmanifest.xml");
});

app.get(["/tcg", "/tcg/"], (req, res) => {
    res.type("text/plain").send("TCG asset server online. Try /tcg/AssetsTcg_manifest.txt");
});

app.use("/server/tcg", express.static(tcgRoot));
app.use("/login/tcg", express.static(tcgRoot));

app.get(["/assets", "/assets/"], (req, res) => {
    res.type("text/plain").send("Game asset server online. Try /assets/Assets_manifest.txt");
});

app.get([
    "/assets/manifest.crc",
    "/assets/manifest.txt.crc",
    "/assets/Assets_manifest.crc",
    "/assets/Assets_manifest.txt.crc",
    "/assets/Assets_manifest_crc",
    "/assets/Assets_manifest.txt_crc"
], (req, res) => {
    readAugmentedAssetManifest((err, data) => {
        if (err) {
            return sendAssetReadFailure(res, "asset-manifest-read-failed", {
                request: req.path,
                path: assetManifestPath,
                response: "crc"
            }, err);
        }
        res.type("text/plain").send(String(crc32(data)));
    });
});

app.get(["/assets/Assets_manifest.txt", "/assets/Assets_manifest"], (req, res) => {
    sendAugmentedAssetManifest(req, res, "manifest");
});

app.get("/assets/Assets_manifest.txt.z", (req, res) => {
    readAugmentedAssetManifest((err, data) => {
        if (err) {
            return sendAssetReadFailure(res, "asset-manifest-read-failed", {
                request: req.path,
                path: assetManifestPath,
                response: "z"
            }, err);
        }
        const compressed = encodeFreeRealmsZ(data);
        logAssetDiagnostic("INFO", "asset-manifest-served", {
            request: req.path,
            response: "z",
            compression: "freerealms-z",
            size: data.length,
            compressedSize: compressed.length,
            crc: crc32(data)
        });
        res.type("application/octet-stream").send(compressed);
    });
});

app.get(["/assets/manifest.txt", "/assets/manifest"], (req, res) => {
    sendPlainAssetManifest(req, res, "plain-manifest");
});

app.get(["/assets/manifest.txt.z", "/assets/manifest.z"], (req, res) => {
    readAugmentedAssetManifest((err, data) => {
        if (err) {
            return sendAssetReadFailure(res, "asset-manifest-read-failed", {
                request: req.path,
                path: assetManifestPath,
                response: "z"
            }, err);
        }
        const compressed = encodeFreeRealmsZ(data);
        logAssetDiagnostic("INFO", "asset-manifest-served", {
            request: req.path,
            response: "z",
            compression: "freerealms-z",
            size: data.length,
            compressedSize: compressed.length,
            crc: crc32(data)
        });
        res.type("application/octet-stream").send(compressed);
    });
});

app.use("/client", express.static(clientRoot));

app.get(/^\/client\/(.+)$/i, (req, res) => {
    const fullPath = safeClientPath(req.params[0]);
    if (!fullPath) {
        logAssetDiagnostic("WARN", "client-file-path-rejected", {
            request: req.path,
            asset: req.params[0],
            response: "file"
        });
        return res.sendStatus(400);
    }

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
        if (/^tcg[\\/]/i.test(req.params[0])) {
            const tcgAsset = resolveTcgAsset(req.params[0]);
            if (tcgAsset) {
                logAssetDiagnostic("INFO", "client-tcg-alias-served", {
                    request: req.path,
                    asset: req.params[0],
                    path: tcgAsset,
                    response: "file",
                    reason: "launcher-client-prefix"
                });
                return sendClientFile(req, res, tcgAsset, {
                    request: req.path,
                    asset: req.params[0],
                    path: tcgAsset,
                    response: "file"
                });
            }
        }
        logAssetDiagnostic("WARN", "client-file-missing", {
            request: req.path,
            asset: req.params[0],
            path: fullPath,
            response: "file"
        });
        return res.sendStatus(404);
    }

    sendClientFile(req, res, fullPath, {
        request: req.path,
        asset: req.params[0],
        path: fullPath,
        response: "file"
    });
});

app.get(/^\/assets\/(.+\.z)$/i, (req, res) => {
    const requested = req.params[0].replace(/\.z$/i, "");
    const fullPath = safeClientPath(requested);
    if (!fullPath) {
        logAssetDiagnostic("WARN", "asset-path-rejected", {
            request: req.path,
            asset: requested,
            response: "z"
        });
        return res.sendStatus(400);
    }

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
        if (isEmptyAssetListFile(requested)) {
            return sendEmptyAssetList(res, {
                request: req.path,
                asset: requested,
                path: fullPath,
                response: "z"
            }, true);
        }

        const generated = resolveGeneratedDdsAsset(requested);
        if (generated) {
            return sendGeneratedDdsAsset(res, generated, {
                request: req.path,
                asset: requested,
                path: fullPath,
                response: "z"
            }, true);
        }

        const packed = resolvePackedAsset(requested);
        if (packed) {
            return sendPackedAsset(res, packed, {
                request: req.path,
                asset: requested,
                path: fullPath,
                response: "z"
            }, true);
        }

        const packedCompressed = resolvePackedAsset(req.params[0]);
        if (packedCompressed) {
            return sendPackedAsset(res, packedCompressed, {
                request: req.path,
                asset: requested,
                path: fullPath,
                response: "z",
                packedResponse: "precompressed"
            }, false);
        }

        const fallbackPacked = resolveMissingAssetFallback(requested);
        if (fallbackPacked) {
            return sendPackedAsset(res, fallbackPacked, {
                request: req.path,
                asset: requested,
                path: fullPath,
                response: "z",
                fallbackSource: fallbackPacked.fallbackSource,
                fallbackReason: fallbackPacked.fallbackReason
            }, true);
        }

        logAssetDiagnostic("WARN", "asset-missing", {
            request: req.path,
            asset: requested,
            path: fullPath,
            response: "z"
        });
        return res.sendStatus(404);
    }

    sendDeflatedClientFile(res, fullPath, {
        request: req.path,
        asset: requested,
        path: fullPath,
        response: "z"
    });
});

app.use("/assets", express.static(clientRoot));

app.get(/^\/assets\/(.+)$/i, (req, res) => {
    const fullPath = safeClientPath(req.params[0]);
    if (!fullPath) {
        logAssetDiagnostic("WARN", "asset-path-rejected", {
            request: req.path,
            asset: req.params[0],
            response: "file"
        });
        return res.sendStatus(400);
    }

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
        if (isEmptyAssetListFile(req.params[0])) {
            return sendEmptyAssetList(res, {
                request: req.path,
                asset: req.params[0],
                path: fullPath,
                response: "file"
            }, false);
        }

        const generated = resolveGeneratedDdsAsset(req.params[0]);
        if (generated) {
            return sendGeneratedDdsAsset(res, generated, {
                request: req.path,
                asset: req.params[0],
                path: fullPath,
                response: "file"
            }, false);
        }

        const packed = resolvePackedAsset(req.params[0]);
        if (packed) {
            return sendPackedAsset(res, packed, {
                request: req.path,
                asset: req.params[0],
                path: fullPath,
                response: "file"
            }, false);
        }

        const fallbackPacked = resolveMissingAssetFallback(req.params[0]);
        if (fallbackPacked) {
            return sendPackedAsset(res, fallbackPacked, {
                request: req.path,
                asset: req.params[0],
                path: fullPath,
                response: "file",
                fallbackSource: fallbackPacked.fallbackSource,
                fallbackReason: fallbackPacked.fallbackReason
            }, false);
        }

        logAssetDiagnostic("WARN", "asset-missing", {
            request: req.path,
            asset: req.params[0],
            path: fullPath,
            response: "file"
        });
        return res.sendStatus(404);
    }

    sendClientFile(req, res, fullPath, {
        request: req.path,
        asset: req.params[0],
        path: fullPath,
        response: "file"
    });
});

registerTcgRoutes(app);
app.use("/tcg", express.static(tcgRoot));

async function sendLocalLauncherLogin(username, password, res, reason, loginServer = localGameLoginServer, requestHints = {}) {
    const user = await findLocalUser(username);

    if (!user) {
        logAssetDiagnostic("WARN", "local-login-failed-user-not-found", { username, reason });
        return res.status(401).json({ error: "invalid username or password" });
    }

    let isValid = false;
    if (user.Password === password) {
        isValid = true;
    } else if (user.Password && user.Password.startsWith("$2")) {
        try {
            isValid = bcrypt.compareSync(password, user.Password);
        } catch (err) {
            console.error("Bcrypt verification failed:", err);
        }
    }

    if (!isValid) {
        logAssetDiagnostic("WARN", "local-login-failed-invalid-password", { username, reason });
        return res.status(401).json({ error: "invalid username or password" });
    }

    const sessionId = crypto.randomBytes(16).toString("hex");
    const synced = await syncLocalLoginSession(username, sessionId);
    if (!synced) {
        return res.status(500).json({ error: "failed to sync session to database" });
    }

    const launchCharacter = await resolveLaunchCharacterForUser(user.Id, { request: requestHints });
    const character = launchCharacter.character;
    const ticketSynced = await syncLocalCharacterTicket(character, sessionId, {
        usernameProvided: true,
        reason
    });
    if (!ticketSynced) {
        return res.status(500).json({ error: "failed to sync character ticket to database" });
    }

    const nativeGuid = resolveNativeLaunchGuid(username, user, character);
    const launchArguments = buildNativeLaunchArguments(loginServer, {
        guid: nativeGuid,
        ticket: sessionId
    });

    logAssetDiagnostic("INFO", "asset-delivery-launch-character-resolved", {
        userId: "local",
        usernameProvided: true,
        reason,
        characterResolution: launchCharacter.reason,
        nativeGuid: nativeGuid || "",
        characterId: character?.Id ?? "",
        characterName: [character?.FirstName, character?.LastName].filter(Boolean).join(" ").trim()
    });

    logAssetDiagnostic("INFO", "asset-delivery-launch-args-local", {
        userId: "local",
        usernameProvided: true,
        sessionId: "present",
        nativeGuid: nativeGuid || "",
        characterId: character?.Id ?? "",
        direct: "False",
        indirect: enableGameIndirectAssets ? "True" : "False",
        loginServer: loginServer,
        assets: `${gameAssetClientBaseUrl}/assets`,
        tcg: `${tcgClientBaseUrl}/tcg`,
        launchDelayMs,
        reason
    });

    return res.json({
        SessionId: sessionId,
        Guid: nativeGuid,
        Ticket: sessionId,
        launchDelayMs,
        LaunchDelayMs: launchDelayMs,
        LaunchArguments: launchArguments
    });
}

app.post(["/login", "/server/login"], async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: "missing credentials" });
    }

    const isRemoteServer = req.path.startsWith("/server");
    const targetLoginServer = isRemoteServer ? publicGameLoginServer : localGameLoginServer;

    let upstream;
    let responseText;
    let fallbackToLocal = false;
    try {
        upstream = await fetch(remoteLoginUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });
        responseText = await upstream.text();
        if (!upstream.ok) {
            fallbackToLocal = true;
        }
    } catch (err) {
        logAssetDiagnostic("ERROR", "remote-login-unreachable-falling-back", {
            usernameProvided: true,
            login: remoteLoginUrl,
            error: err?.message ?? "fetch failed"
        });
        fallbackToLocal = true;
    }

    if (fallbackToLocal) {
        return sendLocalLauncherLogin(username, password, res, "remote-unavailable-or-rejected", targetLoginServer, { ...req.query, ...req.body });
    }

    let payload;
    try {
        payload = responseText ? JSON.parse(responseText) : {};
    } catch (err) {
        logAssetDiagnostic("ERROR", "remote-login-invalid-json", {
            usernameProvided: true,
            login: remoteLoginUrl,
            error: err?.message ?? "invalid json"
        });
        return sendLocalLauncherLogin(username, password, res, "remote-invalid-json", targetLoginServer, { ...req.query, ...req.body });
    }

    const upstreamSessionId = payload.sessionID ?? payload.sessionId ?? payload.SessionId ?? payload.ticket ?? payload.Ticket;
    if (!upstreamSessionId) {
        logAssetDiagnostic("ERROR", "remote-login-missing-session", {
            usernameProvided: true,
            login: remoteLoginUrl,
            keys: Object.keys(payload).join(",")
        });
        return sendLocalLauncherLogin(username, password, res, "remote-missing-session", targetLoginServer, { ...req.query, ...req.body });
    }

    const sessionId = String(upstreamSessionId).trim();
    const synced = await syncLocalLoginSession(username, sessionId);
    if (!synced) {
        return res.status(500).json({ error: "failed to sync session to database" });
    }

    const localUser = await findLocalUser(username);
    const launchCharacter = await resolveLaunchCharacterForUser(localUser?.Id, { payload, request: { ...req.query, ...req.body } });
    const character = launchCharacter.character;
    const launchTicket = String(payload.ticket ?? payload.Ticket ?? sessionId).trim();

    const nativeGuid = resolveNativeLaunchGuid(username, localUser, character);
    const launchArguments = buildNativeLaunchArguments(targetLoginServer, {
        guid: nativeGuid,
        ticket: launchTicket
    });

    delete payload.sessionId;
    delete payload.sessionID;
    delete payload.launchArguments;
    delete payload.ticket;
    payload.SessionId = sessionId;
    payload.sessionID = sessionId;
    payload.Guid = nativeGuid;
    payload.Ticket = launchTicket;
    payload.ticket = launchTicket;
    if (payload.launchDelayMs == null && payload.LaunchDelayMs == null) {
        payload.launchDelayMs = launchDelayMs;
        payload.LaunchDelayMs = launchDelayMs;
    }
    payload.LaunchArguments = launchArguments;

    logAssetDiagnostic("INFO", "asset-delivery-launch-character-resolved", {
        userId: "remote",
        usernameProvided: true,
        characterResolution: launchCharacter.reason,
        nativeGuid: nativeGuid || "",
        characterId: character?.Id ?? "",
        characterName: [character?.FirstName, character?.LastName].filter(Boolean).join(" ").trim(),
        upstreamKeys: Object.keys(payload).slice(0, 24).join(",")
    });

    logAssetDiagnostic("INFO", "asset-delivery-launch-args", {
        userId: "remote",
        usernameProvided: true,
        sessionId: "present",
        nativeGuid: nativeGuid || "",
        characterId: character?.Id ?? "",
        direct: "False",
        indirect: enableGameIndirectAssets ? "True" : "False",
        loginServer: targetLoginServer,
        assets: `${gameAssetClientBaseUrl}/assets`,
        tcg: `${tcgClientBaseUrl}/tcg`,
        launchDelayMs: payload.launchDelayMs ?? payload.LaunchDelayMs ?? launchDelayMs,
        upstreamSessionFormat: normalizeGuidN(upstreamSessionId).match(/^[0-9a-f]{32}$/) ? "guid-n" : "web-or-opaque",
        gatewayTicketSource: "character-login-service",
        login: remoteLoginUrl
    });

    return res.json(payload);
});

app.listen(port, () => {
    console.log(`Auth server running at ${publicBaseUrl}`);
    console.log(`Serving TCG assets from ${tcgRoot}`);
});

if (httpsPort > 0 && httpsPfxPath) {
    try {
        https.createServer({
            pfx: fs.readFileSync(httpsPfxPath),
            passphrase: httpsPfxPassphrase
        }, app).listen(httpsPort, () => {
            console.log(`Auth HTTPS launcher bridge running at https://localhost:${httpsPort}`);
        });
    } catch (err) {
        console.error(`Failed to start Auth HTTPS launcher bridge: ${err?.message ?? err}`);
        process.exitCode = 1;
    }
}
