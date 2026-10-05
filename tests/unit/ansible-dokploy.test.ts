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

  it('pins a release version, never latest or canary', () => {
    const defaults = readFileSync(`${role}/defaults/main.yml`, 'utf8');
    expect(defaults).toMatch(/^dokploy_version: v\d+\.\d+\.\d+$/m);
  });
});
