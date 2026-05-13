import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm, copyFile, mkdir } from "node:fs/promises";
import { build as viteBuild } from "vite";

globalThis.require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function buildClient() {
  console.log("Building client...");
  const outDir = path.resolve(__dirname, "dist/client-dist");
  await viteBuild({
    root: path.resolve(__dirname, "client"),
    base: "/",
    build: {
      outDir,
      emptyOutDir: true,
    },
    configFile: path.resolve(__dirname, "vite.config.ts"),
  });
  console.log("Client built.");
}

async function buildServer() {
  console.log("Building server...");
  const distDir = path.resolve(__dirname, "dist/server");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [path.resolve(__dirname, "server/src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      esbuildPluginPino({ transports: ["pino-pretty"] }),
    ],
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });

  // Copy sql-wasm.wasm for anki importer
  try {
    const ankiRequire = createRequire(
      path.resolve(__dirname, "server/src/anki/index.ts"),
    );
    const wasmSrc = ankiRequire.resolve("sql.js/dist/sql-wasm.wasm");
    await copyFile(wasmSrc, path.join(distDir, "sql-wasm.wasm"));
  } catch {
    // sql.js wasm may be resolved from node_modules
    try {
      const wasmSrc = createRequire(import.meta.url).resolve("sql.js/dist/sql-wasm.wasm");
      await copyFile(wasmSrc, path.join(distDir, "sql-wasm.wasm"));
    } catch {
      console.warn("Could not copy sql-wasm.wasm — anki import may not work");
    }
  }

  console.log("Server built.");
}

async function buildAll() {
  await buildClient();
  await buildServer();
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
