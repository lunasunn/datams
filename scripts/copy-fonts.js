'use strict';

/**
 * Copies JetBrains Mono font files from node_modules into /public so the app
 * is fully self-contained at runtime (no external CDN needed).
 */

const fs = require('fs');
const path = require('path');

const SRC_ROOT = path.join(__dirname, '..', 'node_modules', '@fontsource', 'jetbrains-mono');
const DEST_ROOT = path.join(__dirname, '..', 'public', 'assets', 'font', 'jetbrains-mono');

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function rmDir(p) {
  if (!exists(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyDir(srcDir, destDir) {
  ensureDir(destDir);
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dest);
    } else if (entry.isFile()) {
      copyFile(src, dest);
    }
  }
}

(function main() {
  if (!exists(SRC_ROOT)) {
    console.warn('[fonts] @fontsource/jetbrains-mono not found. Skipping copy.');
    process.exit(0);
  }

  rmDir(DEST_ROOT);
  ensureDir(DEST_ROOT);

  // Copy CSS for weights we actually use (400 + 700)
  for (const cssName of ['400.css', '700.css']) {
    const srcCss = path.join(SRC_ROOT, cssName);
    if (exists(srcCss)) {
      copyFile(srcCss, path.join(DEST_ROOT, cssName));
    } else {
      console.warn(`[fonts] missing ${cssName} in ${SRC_ROOT} (package layout changed?)`);
    }
  }

  // Copy font files referenced by those CSS files
  const srcFiles = path.join(SRC_ROOT, 'files');
  if (exists(srcFiles)) {
    copyDir(srcFiles, path.join(DEST_ROOT, 'files'));
  } else {
    console.warn('[fonts] missing files/ directory in @fontsource/jetbrains-mono');
  }

  console.log(`[fonts] copied JetBrains Mono -> ${DEST_ROOT}`);
})();
