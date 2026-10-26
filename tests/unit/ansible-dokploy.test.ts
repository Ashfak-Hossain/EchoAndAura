import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The Dokploy install script runs as root on a new server (SERVER.md § 8).
 * The copy in the repo is the one that was read and reviewed; its hash is
 * pinned in the role. An accidental edit (an editor trimming whitespace, a
 * merge) must fail here, not halfway through a rebuild.
 */
const role = 'ops/ansible/roles/dokploy';

describe('dokploy role', () => {
  it('runs exactly the reviewed install script', () => {
    const defaults = readFileSync(`${role}/defaults/main.yml`, 'utf8');
    const pinned = defaults.match(/^dokploy_install_sha256: ([0-9a-f]{64})$/m)?.[1];
    const actual = createHash('sha256')
      .update(readFileSync(`${role}/files/dokploy-install.sh`))
      .digest('hex');
    expect(pinned).toBeDefined();
    expect(actual).toBe(pinned);
  });

  // ADR-085: the one change to Dokploy's script. Comments are skipped: its
  // usage notes show `curl … | sh`, which runs nothing. So is the one echo
  // that prints the same advice, by its exact text.
  it('never pipes a download into a shell', () => {
    const printedAdvice =
      'echo "Example: curl -sSL https://dokploy.com/install.sh | sudo ADVERTISE_ADDR=192.168.1.100 sh"';
    const code = readFileSync(`${role}/files/dokploy-install.sh`, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => !line.startsWith('#') && line !== printedAdvice);
    // `| sh`, `| sudo -E bash`, `| /bin/sh`, `bash <(curl …)`, `sh -c "$(curl …)"`.
    const pipeToShell =
      /get\.docker\.com|\|\s*(sudo\b[^|]*?\s)?(\/(usr\/)?bin\/)?(ba|da|z)?sh\b|<\(\s*(curl|wget)\b|\bsh\s+-c\s+["']?\$\(\s*(curl|wget)\b/;
    expect(code.filter((line) => pipeToShell.test(line))).toEqual([]);
  });

  // Strict on the branch's shape on purpose: a newer upstream script has to
  // be re-read and the ADR-085 change made again (the hash test fails too).
  it('stops where Docker is missing', () => {
    const script = readFileSync(`${role}/files/dokploy-install.sh`, 'utf8');
    const branch = script.match(
      /if command_exists docker; then\n[^\n]*\n\s*else\n([\s\S]*?)\n\s*fi\n/,
    )?.[1];
    expect(branch).toBeDefined();
    // Unconditional, and the branch's last statement.
    expect(branch).not.toMatch(/^\s*(if|case|while|for)\b|&&|\|\|/m);
    expect(branch?.trimEnd().split('\n').at(-1)?.trim()).toBe('exit 1');
  });

  it('pins a release version, never latest or canary', () => {
    const defaults = readFileSync(`${role}/defaults/main.yml`, 'utf8');
    expect(defaults).toMatch(/^dokploy_version: v\d+\.\d+\.\d+$/m);
  });
});
