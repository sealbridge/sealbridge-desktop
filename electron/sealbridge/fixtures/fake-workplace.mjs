import { spawn } from "node:child_process";

if (process.argv.includes("--fixture-version")) {
  console.log("fixture-workplace 1.0");
} else {
  console.log("READY");
  console.log(`PID:${process.pid}`);
  if (process.argv.includes("--fixture-grandchild")) {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { windowsHide: true, stdio: "inherit" });
    console.log(`CHILD:${child.pid}`);
  }
  let text = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => { text += chunk; });
  process.stdin.on("end", () => {
    console.log(`RECEIVED:${Buffer.from(text, "utf8").toString("base64")}`);
    console.log("privateKey=fixture-secret-key");
  });
  setInterval(() => {}, 1000);
}
