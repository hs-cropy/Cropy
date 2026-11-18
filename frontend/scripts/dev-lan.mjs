// 같은 와이파이의 휴대폰에서 개발 서버에 접속하기 위한 실행 스크립트.
//   node scripts/dev-lan.mjs            → https://<PC IP>:3000
//   node scripts/dev-lan.mjs --port 3001
//
// 휴대폰 브라우저는 http://<IP> 에서 마이크·카메라(getUserMedia)를 막으므로 HTTPS로 연다.
// 인증서는 이 PC의 IP로 만든 자체 서명 인증서다(시스템 신뢰 저장소는 건드리지 않는다).
// 휴대폰에서 처음 열면 "안전하지 않음" 경고가 나오고, "고급 → 계속"으로 들어가면 된다.
// /api·/uploads는 next.config.js rewrite로 이 PC의 백엔드(127.0.0.1:8000)에 넘어가므로 백엔드는 따로 열 필요가 없다.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const portArg = process.argv.indexOf("--port");
const port = portArg > 0 ? process.argv[portArg + 1] : "3000";

function lanAddress() {
  const candidates = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => a.address);
  // 공유기 사설 대역을 먼저 고른다 (VPN·가상 어댑터 주소 피하기)
  return candidates.find((a) => a.startsWith("192.168.")) ?? candidates.find((a) => a.startsWith("10.")) ?? candidates[0];
}

function findOpenssl() {
  for (const bin of ["openssl", "C:/Program Files/Git/usr/bin/openssl.exe", "C:/Program Files/Git/mingw64/bin/openssl.exe"]) {
    if (spawnSync(bin, ["version"], { stdio: "ignore" }).status === 0) return bin;
  }
  return null;
}

const ip = lanAddress();
if (!ip) {
  console.error("[dev-lan] 와이파이(LAN) IPv4 주소를 찾지 못했어요.");
  process.exit(1);
}

const certDir = path.join(root, ".cert");
const key = path.join(certDir, `lan-${ip}-key.pem`);
const cert = path.join(certDir, `lan-${ip}.pem`);
if (!existsSync(key) || !existsSync(cert)) {
  const openssl = findOpenssl();
  if (!openssl) {
    console.error("[dev-lan] openssl을 찾지 못했어요. Git for Windows를 설치하거나 PATH에 openssl을 추가해 주세요.");
    process.exit(1);
  }
  mkdirSync(certDir, { recursive: true });
  const made = spawnSync(openssl, [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "365",
    "-keyout", key, "-out", cert,
    "-subj", "/CN=cropy-dev-lan",
    "-addext", `subjectAltName=IP:${ip},IP:127.0.0.1,DNS:localhost`,
  ], { stdio: "inherit" });
  if (made.status !== 0) process.exit(made.status ?? 1);
}

// 클라이언트가 API를 같은 출처(이 개발 서버)로 부르게 한다. .env.local의 http://localhost:8000은
// 휴대폰에서는 휴대폰 자신을 가리키고, https 페이지에서 http 호출은 막히기 때문이다
const origin = `https://${ip}:${port}`;
const env = { ...process.env, NEXT_PUBLIC_API_URL: origin };

const prepare = spawnSync(process.execPath, [path.join(root, "scripts", "prepare-offline.mjs")], { cwd: root, stdio: "inherit", env });
if (prepare.status !== 0) process.exit(prepare.status ?? 1);

const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
console.log(`\n[dev-lan] 휴대폰(같은 와이파이)에서 열 주소: ${origin}\n`);
const child = spawn(process.execPath, [
  nextBin, "dev",
  "-H", "0.0.0.0", "-p", port,
  "--experimental-https", "--experimental-https-key", key, "--experimental-https-cert", cert,
], { cwd: root, stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
