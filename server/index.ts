import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import chatHandler from "../api/chat";
import pipelineHandler from "../api/pipeline";
import pdfHandler from "../api/pdf";
import statusHandler from "../api/status";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.use(express.json());

  // Delegate API routes to their respective handlers
  app.post('/api/chat', (req, res) => chatHandler(req, res));
  app.post('/api/pipeline', (req, res) => pipelineHandler(req, res));
  app.post('/api/pdf', (req, res) => pdfHandler(req, res));
  app.get('/api/status', (req, res) => statusHandler(req, res));

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
