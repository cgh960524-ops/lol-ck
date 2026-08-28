import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const blobToken = process.env.BLOB_READ_WRITE_TOKEN || "";
const blobPrefix = process.env.BLOB_PREFIX || "ck-lab-data";

async function blobModule() {
  if (!blobToken) return null;
  return import("@vercel/blob");
}

export async function loadJson(name, localFile, fallback) {
  const blob = name === "runtime-config" ? null : await blobModule();
  if (blob) {
    const result = await blob.list({ prefix: `${blobPrefix}/${name}.json`, limit: 1, token: blobToken });
    const item = result.blobs.find(entry => entry.pathname === `${blobPrefix}/${name}.json`);
    if (item) {
      const response = await fetch(item.url, { cache: "no-store" });
      if (response.ok) return response.json();
    }
  }
  try {
    const localValue = JSON.parse(await readFile(localFile, "utf8"));
    if (blob) await blob.put(`${blobPrefix}/${name}.json`, JSON.stringify(localValue, null, 2), { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json; charset=utf-8", token: blobToken });
    return localValue;
  }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

export async function saveJson(name, localFile, value) {
  const body = JSON.stringify(value, null, 2);
  const blob = name === "runtime-config" ? null : await blobModule();
  if (blob) {
    await blob.put(`${blobPrefix}/${name}.json`, body, {
      access: "public", addRandomSuffix: false, allowOverwrite: true,
      contentType: "application/json; charset=utf-8", token: blobToken,
    });
    return;
  }
  await mkdir(dirname(localFile), { recursive: true });
  const temp = `${localFile}.tmp`;
  await writeFile(temp, body, "utf8");
  await rename(temp, localFile);
}

export const stateFiles = root => ({
  matches: process.env.DATA_FILE || join(root, "data", "internal-matches.json"),
  appState: process.env.APP_STATE_FILE || join(root, "data", "app-state.json"),
  runtime: process.env.RUNTIME_CONFIG_FILE || join(root, "data", "runtime-config.json"),
});
