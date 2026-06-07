import sqlite3pkg from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dbFile = path.join(rootDir, "Emulator", "database", "sanctuary.db");
const sqlite3 = sqlite3pkg.verbose();

const db = new sqlite3.Database(dbFile, (err) => {
    if (err) {
        console.error("Failed to open database:", err.message);
        process.exitCode = 1;
    }
});

db.serialize(() => {
    db.run("UPDATE Characters SET Ticket = NULL");
    db.run("UPDATE Users SET Session = NULL, SessionCreated = NULL", (err) => {
        if (err) {
            console.error("Failed to clear sessions:", err.message);
            process.exitCode = 1;
        } else {
            console.log("Cleared stale user sessions and character tickets.");
        }
    });
});

db.close();
