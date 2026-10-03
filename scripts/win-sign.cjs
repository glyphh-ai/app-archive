/**
 * electron-builder Windows sign hook (`win.signtoolOptions.sign`).
 *
 * EVERY Windows executable carries the SSL.com signature, not just the
 * installer. Until 2026-10-03 CI packed Windows unsigned and ran CodeSignTool
 * over Glyphh-Setup.exe afterwards, so the installed "Glyphh Desktop.exe", the
 * uninstaller and node-pty's winpty-agent.exe shipped unsigned — Norton
 * flagged the app exe as "Suspicious file" on first launch, and SmartScreen
 * reputation never accrued to the binaries users actually run. Signing inside
 * electron-builder covers the app exe, the exes under app.asar.unpacked, the
 * uninstaller and the installer, and latest.yml is computed from the SIGNED
 * installer, so the post-sign hash patch the workflow used to carry is gone.
 *
 * The signer is SSL.com's CodeSignTool jar (eSigner cloud signing). CI
 * downloads it and writes conf/code_sign_tool.properties before packaging
 * (see .github/workflows/build.yml), then points CODE_SIGN_TOOL_JAR at the
 * jar. Credentials come from ES_USERNAME / ES_PASSWORD / ES_CREDENTIAL_ID /
 * ES_TOTP_SECRET. Every call is one eSigner signing against the plan's
 * monthly quota, so files that already carry a valid Authenticode signature
 * (Microsoft's OpenConsole.exe inside node-pty) are left as they are.
 *
 * Local packs without the credentials are left unsigned with a warning; in
 * CI the same situation fails the build rather than shipping unsigned.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CREDENTIALS = ["ES_USERNAME", "ES_PASSWORD", "ES_CREDENTIAL_ID", "ES_TOTP_SECRET"];

/** True when Windows already trusts the file's existing signature. */
function alreadySigned(file) {
  if (process.platform !== "win32") return false;
  const literal = file.replace(/'/g, "''");
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", `(Get-AuthenticodeSignature -LiteralPath '${literal}').Status`],
    { encoding: "utf8" },
  );
  return r.status === 0 && r.stdout.trim() === "Valid";
}

/** @param {{ path: string, hash: string }} configuration */
module.exports = async function sign(configuration) {
  const file = configuration.path;
  const name = path.basename(file);
  const jar = process.env.CODE_SIGN_TOOL_JAR;
  const missing = CREDENTIALS.filter((k) => !process.env[k]);
  if (!jar) missing.push("CODE_SIGN_TOOL_JAR");
  if (missing.length) {
    const why = `missing ${missing.join(", ")}`;
    if (process.env.CI) throw new Error(`[win-sign] ${why} — refusing to ship ${name} unsigned`);
    console.warn(`[win-sign] ${why} — ${name} left unsigned (local pack)`);
    return;
  }
  if (alreadySigned(file)) {
    console.log(`[win-sign] ${name} already carries a valid signature — kept`);
    return;
  }

  // The jar reads conf/code_sign_tool.properties relative to CODE_SIGN_TOOL_PATH
  // and expects to run from that directory (the layout is <root>/jar/<jar>).
  const root = process.env.CODE_SIGN_TOOL_PATH || path.dirname(path.dirname(jar));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "win-sign-"));
  try {
    const r = spawnSync(
      "java",
      [
        "-Xmx1024M",
        "-jar",
        jar,
        "sign",
        `-username=${process.env.ES_USERNAME}`,
        `-password=${process.env.ES_PASSWORD}`,
        `-credential_id=${process.env.ES_CREDENTIAL_ID}`,
        `-totp_secret=${process.env.ES_TOTP_SECRET}`,
        `-input_file_path=${file}`,
        `-output_dir_path=${outDir}`,
        "-malware_block=false",
      ],
      { cwd: root, env: { ...process.env, CODE_SIGN_TOOL_PATH: root }, stdio: "inherit" },
    );
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(`[win-sign] CodeSignTool exited ${r.status} signing ${name}`);
    const signed = path.join(outDir, name);
    if (!fs.existsSync(signed)) throw new Error(`[win-sign] CodeSignTool produced no output for ${name}`);
    // copy + unlink, not rename: the temp dir and the build tree can sit on
    // different drives on the hosted runner (EXDEV).
    fs.copyFileSync(signed, file);
    console.log(`[win-sign] signed ${name}`);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
};
