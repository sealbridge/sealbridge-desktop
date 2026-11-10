import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = file => readFileSync(new URL(`../../${file}`, import.meta.url));
const json = file => JSON.parse(read(file));

test("Bundled core archives, runtime lock and preparation share the reviewed pin", () => {
  const pin = json("vendor/sealbridge/provenance.json");
  assert.equal(pin.commit, "3b20ca1eb9d5f5dd950cb7ac6c21a82abe4dbc15");
  assert.equal(pin.version, "0.6.3");
  assert.equal(pin.sourceSha256, "87b05f7bc49bbcaf2b4cb0229669b3a14e9e808e30867587c6e4bedae215ac17");
  assert.equal(pin.packageSha256, "818710806506292c83a615702279d31616c1f5da430bdbbd39afe2902b9d382c");
  for (const [name, hash] of [["source.tar.gz", pin.sourceSha256], ["sealbridge-0.6.3.tgz", pin.packageSha256]])
    assert.equal(createHash("sha256").update(read(`vendor/sealbridge/${name}`)).digest("hex"), hash);
  const file = "file:../../vendor/sealbridge/sealbridge-0.6.3.tgz";
  assert.equal(json("runtime/sealbridge/package.json").dependencies.sealbridge, file);
  const lock = json("runtime/sealbridge/package-lock.json").packages["node_modules/sealbridge"];
  assert.equal(lock.version, pin.version); assert.equal(lock.resolved, file);
  assert.equal(lock.integrity, "sha512-" + createHash("sha512").update(read("vendor/sealbridge/sealbridge-0.6.3.tgz")).digest("base64"));
  assert.ok(read("electron-builder.yml").toString().includes("  - shared/context-pooling-copy.json"));
  const prepare = read("scripts/prepare-sealbridge-runtime.mjs").toString();
  assert.ok(prepare.indexOf('throw new Error("Core archive integrity mismatch")') < prepare.indexOf('"ci"'));
  assert.ok(prepare.includes('"sealbridge-0.6.3.tgz", provenance.packageSha256'));
});
