import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import { authMiddleware } from "./middlewares/authMiddleware";
import { decodeB64Body } from "./middlewares/decodeB64Body";
import router from "./routes";
import { logger } from "./lib/logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));
app.use(decodeB64Body);
app.use(authMiddleware);

app.use("/api", router);

if (process.env.NODE_ENV === "production") {
  const clientDist = path.resolve(__dirname, "../client-dist");
  const indexHtml = path.join(clientDist, "index.html");
  app.use(express.static(clientDist));
  app.get("/{*path}", (req, res, next) => {
    if (req.originalUrl.startsWith("/api/")) {
      next();
      return;
    }
    res.sendFile(indexHtml);
  });
}

export default app;