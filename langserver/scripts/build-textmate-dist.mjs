/**
 * Builds textmate-dist/inform6.tmbundle/ — a TextMate bundle directory
 * suitable for use with IntelliJ IDEA's TextMate Bundles support.
 *
 * IntelliJ requires:
 *   - info.plist at the bundle root
 *   - grammar in XML plist (.tmLanguage) format, not JSON
 *
 * Point IntelliJ at: <repo>/langserver/textmate-dist/inform6.tmbundle
 * via Settings → Editor → TextMate Bundles → Add.
 */
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const bundleDir   = path.join(root, "textmate-dist", "inform6.tmbundle");
const syntaxesDir = path.join(bundleDir, "Syntaxes");

await rm(path.join(root, "textmate-dist"), { recursive: true, force: true });
await mkdir(syntaxesDir, { recursive: true });

// --- info.plist (required by IntelliJ) ---
await writeFile(path.join(bundleDir, "info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>name</key>
\t<string>Inform 6</string>
\t<key>uuid</key>
\t<string>8f4a2b1c-3d5e-4f67-89ab-cdef01234567</string>
</dict>
</plist>
`);

// --- Convert inform6.tmLanguage.json → inform6.tmLanguage (XML plist) ---
const grammar = JSON.parse(
  await readFile(path.join(root, "syntaxes", "inform6.tmLanguage.json"), "utf-8")
);

function toPlist(value, depth = 0) {
  const indent = "\t".repeat(depth);
  if (typeof value === "string") {
    return `${indent}<string>${escapeXml(value)}</string>`;
  }
  if (typeof value === "boolean") {
    return `${indent}<${value}/>`;
  }
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? `${indent}<integer>${value}</integer>`
      : `${indent}<real>${value}</real>`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return `${indent}<array/>`;
    const items = value.map(v => toPlist(v, depth + 1)).join("\n");
    return `${indent}<array>\n${items}\n${indent}</array>`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .map(([k, v]) => `${indent}\t<key>${escapeXml(k)}</key>\n${toPlist(v, depth + 1)}`)
      .join("\n");
    return `${indent}<dict>\n${entries}\n${indent}</dict>`;
  }
  return `${indent}<string></string>`;
}

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
${toPlist(grammar)}
</plist>
`;

await writeFile(path.join(syntaxesDir, "inform6.tmLanguage"), plist);

console.log(`Built: ${bundleDir}`);
