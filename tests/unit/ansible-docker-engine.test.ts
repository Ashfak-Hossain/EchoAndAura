import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * ADR-085: a new server gets Docker from Docker's own apt repository,
 * trusting only the key kept in the repo, before Dokploy's script runs.
 * The key is checked by hash like the script; the order of the roles is
 * what keeps the origin lockdown in place from Docker's first start.
 * The tasks are read as YAML, so a comment can't satisfy a test.
 */
const role = 'ops/ansible/roles/docker_engine';

type Task = Record<string, unknown>;
const read = () => ({
  defaults: parse(readFileSync(`${role}/defaults/main.yml`, 'utf8')) as Record<string, unknown>,
  tasks: parse(readFileSync(`${role}/tasks/main.yml`, 'utf8')) as Task[],
});
const only = (tasks: Task[], module: string) => {
  const found = tasks.filter((t) => module in t);
  expect(found).toHaveLength(1);
  return found[0] as Task;
};

describe('docker_engine role', () => {
  it('trusts exactly the reviewed apt key', () => {
    const { defaults } = read();
    const actual = createHash('sha256')
      .update(readFileSync(`${role}/files/docker.asc`))
      .digest('hex');
    expect(defaults.docker_engine_apt_key_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(actual).toBe(defaults.docker_engine_apt_key_sha256);
  });

  it("pins the Docker version Dokploy's script names", () => {
    const { defaults } = read();
    const script = readFileSync('ops/ansible/roles/dokploy/files/dokploy-install.sh', 'utf8');
    const expected = script.match(/^DOCKER_VERSION="(\d+\.\d+\.\d+)"$/m)?.[1];
    expect(expected).toBeDefined();
    expect(String(defaults.docker_engine_version)).toBe(expected);
  });

  it('installs the engine packages at that version', () => {
    const { tasks } = read();
    const install = only(tasks, 'ansible.builtin.apt');
    const apt = install['ansible.builtin.apt'] as Record<string, unknown>;
    const vars = install.vars as Record<string, string>;
    expect(apt.name).toMatch(
      /docker_engine_held_packages \| map\('regex_replace', '\$', '=' ~ docker_engine_deb_version\)/,
    );
    expect(vars.docker_engine_deb_version).toMatch(/^5:\{\{ docker_engine_version \}\}-1~ubuntu\./);
  });

  it('holds the engine packages', () => {
    const { defaults, tasks } = read();
    expect(defaults.docker_engine_held_packages).toEqual(
      expect.arrayContaining(['docker-ce', 'docker-ce-cli', 'docker-ce-rootless-extras']),
    );
    const hold = only(tasks, 'ansible.builtin.dpkg_selections');
    expect(hold['ansible.builtin.dpkg_selections']).toEqual({
      name: '{{ item }}',
      selection: 'hold',
    });
    expect(hold.loop).toBe('{{ docker_engine_held_packages }}');
    expect(hold.when).toBe(only(tasks, 'ansible.builtin.apt').when);
  });

  it('reads the repository over https, signed by that key only', () => {
    const { tasks } = read();
    const copies = tasks
      .filter((t) => 'ansible.builtin.copy' in t)
      .map((t) => t['ansible.builtin.copy'] as Record<string, string>);
    const key = copies.find((c) => c.src === 'docker.asc');
    const list = copies.find((c) => c.dest === '/etc/apt/sources.list.d/docker.list');
    expect(key?.dest).toMatch(/^\/etc\/apt\/keyrings\//);
    const line = list?.content.match(/^deb \[([^\]]*)\] (\S+) /);
    const options = line?.[1].split(' ') ?? [];
    expect(options).toContain(`signed-by=${key?.dest}`);
    expect(options.some((o) => o.startsWith('trusted='))).toBe(false);
    expect(line?.[2]).toBe('https://download.docker.com/linux/ubuntu');
    // A key trusted for every repository would undo signed-by.
    expect(JSON.stringify(tasks)).not.toMatch(/trusted\.gpg|\bapt_key\b|\bapt_repository\b/);
  });

  it('runs after daemon.json and the lockdown, before Dokploy', () => {
    const [play] = parse(readFileSync('ops/ansible/site.yml', 'utf8')) as [
      { roles: { role: string }[] },
    ];
    const order = play.roles.map((r) => r.role);
    const at = (name: string) => {
      expect(order).toContain(name);
      return order.indexOf(name);
    };
    expect(at('docker_config')).toBeLessThan(at('docker_engine'));
    expect(at('origin_lockdown')).toBeLessThan(at('docker_engine'));
    expect(at('docker_engine')).toBeLessThan(at('dokploy'));
  });
});
