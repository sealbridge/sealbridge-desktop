import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as edition from "./edition.ts";

let directory: string | undefined;
afterEach(() => {
  vi.unstubAllEnvs();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("open-source edition", () => {
  it("always reports the compatible edition and Settings wire shapes", () => {
    const status = edition.editionStatus({});
    expect(status).toEqual({ edition: "oss", features: [] });
    expect(edition.editionForMembers(status)).toEqual(status);
    expect(edition.editionForSettings(status)).toEqual(status);
    expect(edition.describeEdition(status)).toBe("Sealbridge Desktop open-source edition");
  });
  it.each(["OMB_LICENSE_KEY", "OMB_ENTERPRISE_DIR"])("continues as OSS with an operator notice for %s, including an empty value", key => {
    for (const value of ["", "fixture-private-value"]) {
      vi.stubEnv(key, value);
      const status = edition.editionStatus();
      expect(status).toEqual({ edition: "oss", features: [], notice: `${key} has no effect in this distribution.` });
      expect(JSON.stringify(status)).not.toContain("fixture-private-value");
      expect(edition.describeEdition(status)).toBe(`Sealbridge Desktop open-source edition (${status.notice})`);
      expect(edition.editionForMembers(status)).toEqual({ edition: "oss", features: [] });
      expect(edition.editionForSettings(status)).toEqual({ edition: "oss", features: [] });
    }
  });
  it("names both ignored settings without including their values", () => {
    expect(edition.editionStatus({ OMB_LICENSE_KEY: "", OMB_ENTERPRISE_DIR: "" }).notice)
      .toBe("OMB_LICENSE_KEY, OMB_ENTERPRISE_DIR have no effect in this distribution.");
  });
  it("never reads or executes a supplied external layer", () => {
    directory = mkdtempSync(join(tmpdir(), "oss-edition-"));
    const marker = join(directory, "executed");
    mkdirSync(join(directory, "server"));
    writeFileSync(join(directory, "server", "index.js"), `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "executed"); export function register() { return { features: ["admin"] }; }`);
    expect(edition.editionStatus({ OMB_ENTERPRISE_DIR: directory })).toMatchObject({ edition: "oss", features: [] });
    expect(existsSync(marker)).toBe(false);
  });
  it("never grants any entitlement and cannot be changed through a returned status", () => {
    edition.editionStatus({}).features.push("admin");
    for (const feature of ["admin", "budgets", "billing", "whitelabel", "unknown", ""]) {
      expect(edition.entitled(feature)).toBe(false);
    }
    expect(edition.editionStatus({})).toEqual({ edition: "oss", features: [] });
  });
  it("exposes no loader or license-key API", () => {
    expect(Object.keys(edition).sort()).toEqual([
      "describeEdition", "editionForMembers", "editionForSettings", "editionStatus", "entitled",
    ]);
  });
});
