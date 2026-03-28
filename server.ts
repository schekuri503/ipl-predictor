import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API routes go here
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/sync-sheets", async (req, res) => {
    /* 
    // Temporarily disabled due to OpenSSL private key decoding errors
    // (error:1E08010C:DECODER routines::unsupported)
    // The logic has been moved to /src/sheets-sync-logic.json for reference.
    const { matchId, userId, userName, prediction } = req.body;
    const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
    const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    let GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;

    if (!SPREADSHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
      console.error("Missing Google Sheets configuration");
      return res.status(500).json({ error: "Google Sheets not configured" });
    }

    // ... (rest of the logic) ...
    */
    res.status(501).json({ 
      error: "Google Sheets sync is temporarily disabled", 
      details: "The sync feature is currently under maintenance due to OpenSSL private key decoding issues." 
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting in DEVELOPMENT mode");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting in PRODUCTION mode");
    const distPath = path.resolve(__dirname, "dist");
    console.log(`Serving static files from: ${distPath}`);
    
    // Serve static assets with a long cache time
    app.use(express.static(distPath, { index: false }));
    
    // Fallback to index.html for all other routes (SPA)
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
