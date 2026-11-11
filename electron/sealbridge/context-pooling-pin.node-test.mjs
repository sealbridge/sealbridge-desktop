import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = file => readFileSync(new URL(`../../${file}`, import.meta.url));
const json = file => JSON.parse(read(file));

test("Bundled core archives, runtime lock and preparation share the reviewed pin", () => {
  const pin = json("vendor/sealbridge/provenance.json");
  assert.equal(pin.commit, "77c6140c75e5fec89428727de00aca217a4cbb0c");
  assert.equal(pin.version, "0.7.0");
  assert.equal(pin.packageName, "sealbridge-local");
  assert.equal(pin.npmProvenance, false);
  assert.equal(pin.sourceSha256, "6dfe127515f0dbbf84ffd7ce27466aca9a29186d1e0429e26a903d7e405e79b8");
  assert.equal(pin.packageSha256, "c4f5ce2a23551fe32d20c0dfd590159a648753c6182467167c56d5788aeaed0e");
  for (const [name, hash] of [["source.tar.gz", pin.sourceSha256], ["sealbridge-local-0.7.0.tgz", pin.packageSha256]])
    assert.equal(createHash("sha256").update(read(`vendor/sealbridge/${name}`)).digest("hex"), hash);
  const file = "file:../../vendor/sealbridge/sealbridge-local-0.7.0.tgz";
  assert.equal(json("runtime/sealbridge/package.json").dependencies["sealbridge-local"], file);
  const lock = json("runtime/sealbridge/package-lock.json").packages["node_modules/sealbridge-local"];
  assert.equal(lock.version, pin.version); assert.equal(lock.resolved, file);
  assert.equal(lock.integrity, pin.npmIntegrity);
  assert.equal(lock.integrity, "sha512-" + createHash("sha512").update(read("vendor/sealbridge/sealbridge-local-0.7.0.tgz")).digest("base64"));
  assert.ok(read("electron-builder.yml").toString().includes("  - shared/context-pooling-copy.json"));
  const prepare = read("scripts/prepare-sealbridge-runtime.mjs").toString();
  assert.ok(prepare.indexOf('throw new Error("Core archive integrity mismatch")') < prepare.indexOf('"ci"'));
  assert.ok(prepare.includes('"sealbridge-local-0.7.0.tgz", provenance.packageSha256'));
});
