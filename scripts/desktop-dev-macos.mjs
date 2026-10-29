import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync, renameSync, symlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
if (process.platform !== 'darwin' || process.env.RIPPLE_DESKTOP_DEV !== '1' || !process.env.RIPPLE_DEV_WORK || !process.argv[2]) throw new Error('Use the managed Ripple Dev entry point.');
const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = join(process.env.RIPPLE_DEV_WORK, 'Ripple Dev.app');
const contents = join(bundle, 'Contents');
const executable = join(contents, 'MacOS/ripple-desktop');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
const sourceDirty = execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim() !== '';
mkdirSync(join(contents, 'MacOS'), { recursive: true });
mkdirSync(join(contents, 'Resources/backend/site-packages'), { recursive: true });
// Source-backed resources retain the native connector commands without copying credentials.
for (const [name, target] of [['python', 'backend/.venv'], ['backend', 'backend'], ['mock-data', 'mock-data']]) {
  const link = join(contents, 'Resources/backend', name);
  if (!existsSync(link)) symlinkSync(join(root, target), link);
}
writeFileSync(join(contents, 'Resources/dev-runtime.json'), JSON.stringify({node:process.execPath,root,work:process.env.RIPPLE_DEV_WORK}));
copyFileSync(process.argv[2], `${executable}.next`);
renameSync(`${executable}.next`, executable);
copyFileSync(join(root, 'desktop/src-tauri/icons/icon.icns'), join(contents, 'Resources/icon.icns'));
writeFileSync(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>studio.ripple.app.segmentdev</string>
<key>CFBundleName</key><string>Ripple Dev</string>
<key>CFBundleDisplayName</key><string>Ripple Dev</string>
<key>CFBundleExecutable</key><string>ripple-desktop</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIconFile</key><string>icon.icns</string>
<key>RippleGitCommit</key><string>${sourceCommit}</string>
<key>RippleSourceDirty</key><${sourceDirty ? "true" : "false"}/>
<key>RippleBuildTime</key><string>${new Date().toISOString()}</string>
<key>CFBundleURLTypes</key><array><dict><key>CFBundleURLName</key><string>Ripple Segment Dev</string><key>CFBundleURLSchemes</key><array><string>ripple-segment-dev</string></array></dict></array>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>`);
process.execve(executable, [executable, ...process.argv.slice(3)], process.env);
