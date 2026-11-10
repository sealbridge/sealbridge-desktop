import path from "node:path";
import { pathToFileURL } from "node:url";

export function loadCoreSdk(packageDir) {
  return import(pathToFileURL(path.resolve(packageDir, "../../sdk-entry.mjs")).href);
}
