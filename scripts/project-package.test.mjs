import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

test('production metadata registers a directory package without changing URL handling', () => {
  const repo = resolve(import.meta.dirname, '..');
  const script = readFileSync(join(repo, 'desktop/package-mac.sh'), 'utf8');
  const python = script.split('"$REPO" <<\'PY\'\n')[1]?.split('\nPY')[0];
  assert.ok(python, 'exercise the actual packaging metadata generator');
  const temporary = mkdtempSync(join(tmpdir(), 'ripple-package-metadata-'));
  try {
    const output = join(temporary, 'Info.plist');
    execFileSync('python3', ['-', output, '0.2.0-beta.1', '1', 'synthetic', 'Synthetic.icns', join(repo, 'desktop/segment-link-config.json'), repo], { input: python });
    const metadata = JSON.parse(execFileSync('python3', ['-c', 'import json,plistlib,sys;print(json.dumps(plistlib.load(open(sys.argv[1],"rb"))))', output], { encoding: 'utf8' }));
    const [document] = metadata.CFBundleDocumentTypes;
    const [type] = metadata.UTExportedTypeDeclarations;
    assert.deepEqual(document.LSItemContentTypes, [type.UTTypeIdentifier]);
    assert.equal(document.LSTypeIsPackage, true);
    assert.equal(document.CFBundleTypeRole, 'Editor');
    assert.deepEqual(type.UTTypeConformsTo, ['com.apple.package']);
    assert.deepEqual(type.UTTypeTagSpecification['public.filename-extension'], ['ripple']);
    assert.equal(document.CFBundleTypeIconFile, 'project.icns');
    assert.match(script, /cp "\$DESKTOP\/src-tauri\/icons\/project.icns" "\$APP\/Contents\/Resources\/project.icns"/);
    assert.deepEqual(metadata.CFBundleURLTypes[0].CFBundleURLSchemes, ['ripple-transcript']);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
