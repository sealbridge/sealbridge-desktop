import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = file => readFileSync(new URL(`../../${file}`, import.meta.url));
const json = file => JSON.parse(read(file));

test("Bundled core archives, runtime lock and preparation share the reviewed pin", () => {
  const pin = json("vendor/sealbridge/provenance.json");
  assert.equal(pin.commit, "1e6f7a4fe8f6cce0aab7973eac8e85cda0723516");
  assert.equal(pin.version, "0.6.3");
  assert.equal(pin.sourceSha256, "e3ea5da9c1a861725dd8bd39798bef42057659f4409189b4504900944d381a74");
  assert.equal(pin.packageSha256, "5a0b273d031756ee914c54fa850dcd32eb162109fd6a8823260bd217586aad39");
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
