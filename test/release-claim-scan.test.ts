import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const scanner = 'scripts/check-forbidden-claims.mjs';

test('release claim scan permits explicit non-claims from every packaged text surface', () => {
  const result = spawnSync(process.execPath, [scanner], {
    encoding: 'utf8',
    input: [
      'Local speech work is reserved for a future release and remains pending.',
      'יכולת דיבור על המכשיר נשקלת לגרסה עתידית ואינה זמינה כעת.',
      'This release does not provide local/offline/keyless speech.',
      'Never label local speech ready.',
      'System TTS is OS-dependent; local TTS is not included.',
      'No built-in voice is available with this package.',
      'Do not install a voice from this extension.',
      'No voice download is required by the extension.',
      'The extension does not work offline.',
      'We do not claim that no API key is required.',
      'Local speech is not ready.',
      '`Local ready`, `Download required`, and `No key required` are prohibited copy.',
    ].join('\n'),
  });

  assert.equal(result.status, 0, result.stderr);
});

test('release claim scan rejects the exact stale bilingual local-speech path copy', () => {
  for (const staleCopy of [
    'Local speech: Pending — not available in this version',
    'דיבור מקומי: בהמתנה — אינו זמין בגרסה זו',
  ]) {
    const result = spawnSync(process.execPath, [scanner], {
      encoding: 'utf8', input: staleCopy,
    });
    assert.notEqual(result.status, 0, staleCopy);
    assert.match(result.stderr, /stale .*local-speech path copy/iu);
  }
});

test('release extraction treats VSIX metadata as text and escapes the literal content-types member', () => {
  const release = readFileSync('scripts/release.sh', 'utf8');
  assert.match(release, /\*\.png\|\*\.node\)[\s\S]*?\*\)/u);
  assert.ok(release.includes("archive_member='\\[Content_Types\\].xml'"));

  const root = mkdtempSync(join(tmpdir(), 'voice-input-claim-archive-'));
  const archive = join(root, 'fixture.zip');
  try {
    writeFileSync(join(root, '[Content_Types].xml'), '<Types>Local speech is ready.</Types>', 'utf8');
    writeFileSync(join(root, 'extension.vsixmanifest'), '<Manifest>Voice Input works offline.</Manifest>', 'utf8');
    execFileSync('zip', ['-q', archive, '[Content_Types].xml', 'extension.vsixmanifest'], {
      cwd: root,
    });
    const contentTypes = execFileSync(
      'unzip', ['-p', archive, '\\[Content_Types\\].xml'], { encoding: 'utf8' },
    );
    const manifest = execFileSync(
      'unzip', ['-p', archive, 'extension.vsixmanifest'], { encoding: 'utf8' },
    );
    assert.equal(contentTypes, '<Types>Local speech is ready.</Types>');
    assert.equal(manifest, '<Manifest>Voice Input works offline.</Manifest>');
    const scan = spawnSync(process.execPath, [scanner], {
      encoding: 'utf8', input: `${contentTypes}\n${manifest}`,
    });
    assert.notEqual(scan.status, 0);
    assert.match(scan.stderr, /local readiness/u);
    assert.match(scan.stderr, /offline operation/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release claim scan rejects every named positive prohibited claim', () => {
  for (const claim of [
    'A built-in voice is available now.',
    'Install a voice to continue.',
    'A voice download is required.',
    'Voice Input works offline.',
    'No API key is required.',
    'Local speech is ready.',
    'Keyless speech ships today.',
    'Offline transcription is enabled.',
    'Local TTS is ready for every platform.',
    'Local speech is included with the extension.',
  ]) {
    const result = spawnSync(process.execPath, [scanner], {
      encoding: 'utf8',
      input: claim,
    });
    assert.notEqual(result.status, 0, claim);
    assert.match(result.stderr, /forbidden/u);
  }
});
