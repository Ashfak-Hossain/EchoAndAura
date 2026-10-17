import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { isNode, parse, parseDocument } from 'yaml';

// ADR-080: the dev container runs what production and CI run. Its Node and
// pnpm follow the root Dockerfile and package.json, every image and feature
// is pinned, and Dependabot watches them. The compose overrides keep the
// services off the host's ports and container names, so the box can run
// beside a stack started with `docker compose up`.

const read = (path: string) => readFileSync(path, 'utf8');

const devDockerfile = read('.devcontainer/Dockerfile');
const config = ts.parseConfigFileTextToJson(
  'devcontainer.json',
  read('.devcontainer/devcontainer.json'),
).config as { features: Record<string, unknown>; dockerComposeFile: string[]; service: string };
const lock = JSON.parse(read('.devcontainer/devcontainer-lock.json')) as {
  features: Record<string, { version: string; resolved: string; integrity: string }>;
};

type Service = { ports?: unknown; container_name?: unknown; network_mode?: unknown };
const root = (parse(read('docker-compose.yml')) as { services: Record<string, Service> }).services;
// `!reset` is Compose's own tag (it drops the value the root file set), so
// the overrides are read as nodes, tags kept.
const overrides = parseDocument(read('.devcontainer/compose.yaml'), { logLevel: 'error' });
const override = (service: string, key: string): { tag?: string; value?: unknown } => {
  const node: unknown = overrides.getIn(['services', service, key], true);
  return isNode(node) ? { tag: node.tag, value: node.toJSON() as unknown } : {};
};

describe('the dev container', () => {
  it('runs the Node image production builds from, pinned by digest', () => {
    const prodImage = /^ARG NODE_IMAGE=(\S+)$/m.exec(read('Dockerfile'))?.[1];
    const from = /^FROM (\S+)@sha256:[0-9a-f]{64}$/m.exec(devDockerfile)?.[1];
    expect(prodImage).toBeDefined();
    expect(from).toBe(prodImage);
  });

  it('runs the Node major .nvmrc names', () => {
    const major = /^FROM node:(\d+)\./m.exec(devDockerfile)?.[1];
    expect(major).toBe(read('.nvmrc').trim());
  });

  it('installs the pnpm package.json names', () => {
    const { packageManager } = JSON.parse(read('package.json')) as { packageManager: string };
    expect(devDockerfile).toContain(`npm install -g ${packageManager}`);
  });

  it('installs jq, which the Claude hooks and statusline call', () => {
    // Without it, claude-hooks and claude-workspace tests fail in the box only.
    const scripts = ['.claude/statusline.sh', '.claude/hooks/guard-bash.sh'];
    for (const script of scripts) expect(read(script), script).toMatch(/\bjq\b/);
    expect(devDockerfile).toMatch(/apt-get install [^\n]*\bjq\b/);
  });

  it('pins every feature to an exact version, and the lock file to a digest', () => {
    const features = Object.keys(config.features);
    expect(features.length).toBeGreaterThan(0);
    for (const id of features) {
      const version = /^ghcr\.io\/devcontainers\/features\/[\w-]+:(\d+\.\d+\.\d+)$/.exec(id)?.[1];
      expect(version, id).toBeDefined();
      expect(lock.features[id]?.version, id).toBe(version);
      expect(lock.features[id]?.integrity, id).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
    expect(Object.keys(lock.features).sort()).toEqual([...features].sort());
    // The host's Docker socket is root on a Linux host, and nothing here needs it.
    expect(features.join()).not.toMatch(/docker-(outside-of|in)-docker/);
  });

  it('merges its compose file over the root one', () => {
    expect(config.dockerComposeFile).toEqual(['../docker-compose.yml', 'compose.yaml']);
    expect(overrides.hasIn(['services', config.service])).toBe(true);
  });

  it('runs as a Compose project of its own, not the host stack', () => {
    // Unnamed, the project takes the first file's folder name: the host's.
    const name = overrides.get('name');
    expect(name).toEqual(expect.any(String));
    expect(name).not.toBe('echoandaura');
  });

  it('publishes no host port and names no container', () => {
    for (const [name, service] of Object.entries(root)) {
      if (service.ports !== undefined) {
        expect(override(name, 'ports'), name).toEqual({ tag: '!reset', value: [] });
        expect(override(name, 'network_mode').value, name).toBe(`service:${config.service}`);
      }
      if (service.container_name !== undefined) {
        expect(override(name, 'container_name').tag, name).toBe('!reset');
      }
    }
  });

  it('is watched by Dependabot: the image and the features', () => {
    const { updates } = parse(read('.github/dependabot.yml')) as {
      updates: { 'package-ecosystem': string; directory?: string; directories?: string[] }[];
    };
    const dirs = (ecosystem: string) =>
      updates
        .filter((u) => u['package-ecosystem'] === ecosystem)
        .flatMap((u) => u.directories ?? (u.directory === undefined ? [] : [u.directory]));
    expect(dirs('docker')).toContain('/.devcontainer');
    expect(dirs('devcontainers')).toContain('/');
  });
});
