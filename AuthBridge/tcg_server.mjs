import express from "express";
import { fileURLToPath } from "url";
import path from "path";
import { registerTcgRoutes, tcgRoot } from "./tcgAssetHelpers.mjs";

const app = express();
const port = Number(process.env.TCG_PORT ?? 3001);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.get(["/", "/tcg", "/tcg/"], (req, res) => {
    res.type("text/plain").send("Kaine TCG asset server online");
});

registerTcgRoutes(app, { includeRootAliases: true });
app.use("/tcg", express.static(tcgRoot));

app.listen(port, "127.0.0.1", () => {
    console.log(`Kaine TCG asset server running at http://127.0.0.1:${port}/tcg`);
    console.log(`Serving files from ${tcgRoot}`);
});
