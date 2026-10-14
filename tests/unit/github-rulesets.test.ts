import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { drift, readRulesetFiles, type Ruleset } from '../../scripts/rulesets-check';

// ADR-074: GitHub's rulesets as files. Two for release tags, because a
// bypass covers every rule in its ruleset: the owner may create a `v*` tag,
// and nobody, the owner included, may move or delete one. A version always
// means the same commit and the same images (ADR-041).

const TAGS = { exclude: [], include: ['refs/tags/v*'] };
const ADMIN = { actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' };

const ruleTypes = (r: Ruleset) => (r.rules as { type: string }[]).map((rule) => rule.type).sort();

/** What is wrong with the "never move" ruleset; empty when it holds. */
function neverMoveProblems(r: Ruleset): string[] {
  return [
    ...(r.target === 'tag' ? [] : ['target is not tag']),
    ...(r.enforcement === 'active' ? [] : ['not active']),
    ...(JSON.stringify(r.conditions) === JSON.stringify({ ref_name: TAGS })
      ? []
      : ['does not cover exactly refs/tags/v*']),
    ...(JSON.stringify(ruleTypes(r)) === JSON.stringify(['deletion', 'non_fast_forward', 'update'])
      ? []
      : [`rules are ${ruleTypes(r).join(', ')}`]),
    ...((r.bypass_actors as unknown[]).length === 0 ? [] : ['someone can bypass it']),
  ];
}

const byName = (name: string) => {
  const found = readRulesetFiles().find((r) => r.name === name);
  if (found === undefined) throw new Error(`no ruleset file named "${name}"`);
  return found;
};

describe('the ruleset files', () => {
  it('are exactly the three rulesets, with only the fields a ruleset is created from', () => {
    const files = readRulesetFiles();
    expect(files.map((r) => r.name).sort()).toEqual([
      'main is production',
      'release tags never move',
      'release tags: owner creates',
    ]);
    for (const r of files) {
      expect(Object.keys(r).sort(), r.name).toEqual(
        ['bypass_actors', 'conditions', 'enforcement', 'name', 'rules', 'target'].sort(),
      );
    }
  });

  it('let only the owner (the repository admin role) create a release tag', () => {
    const r = byName('release tags: owner creates');
    expect(r.target).toBe('tag');
    expect(r.enforcement).toBe('active');
    expect(r.conditions).toEqual({ ref_name: TAGS });
    expect(ruleTypes(r)).toEqual(['creation']);
    expect(r.bypass_actors).toEqual([ADMIN]);
  });

  it('let nobody move or delete a release tag, admins included', () => {
    expect(neverMoveProblems(byName('release tags never move'))).toEqual([]);
  });

  it('keep main as production: PR-only, verify required, no bypass', () => {
    const r = byName('main is production');
    expect(r.target).toBe('branch');
    expect(r.enforcement).toBe('active');
    expect(r.conditions).toEqual({ ref_name: { exclude: [], include: ['~DEFAULT_BRANCH'] } });
    expect(ruleTypes(r)).toEqual([
      'deletion',
      'non_fast_forward',
      'pull_request',
      'required_status_checks',
    ]);
    expect(r.bypass_actors).toEqual([]);
    expect(JSON.stringify(r.rules)).toContain('{"context":"verify"}');
  });

  it('match the tag pattern the Release workflow runs on', () => {
    // release.yml fires on vX.Y.Z; every such tag must fall under refs/tags/v*.
    expect(readFileSync('.github/workflows/release.yml', 'utf8')).toContain(
      "tags: ['v[0-9]+.[0-9]+.[0-9]+']",
    );
  });
});

describe('the "never move" check', () => {
  const good = byName('release tags never move');
  it.each<[string, Partial<Ruleset>]>([
    ['a bypass for the admin', { bypass_actors: [ADMIN] }],
    ['a missing deletion rule', { rules: [{ type: 'update' }, { type: 'non_fast_forward' }] }],
    ['creation mixed in', { rules: [{ type: 'creation' }, ...(good.rules as { type: string }[])] }],
    [
      'every tag, not just versions',
      { conditions: { ref_name: { exclude: [], include: ['refs/tags/*'] } } },
    ],
    ['evaluate mode (logs, refuses nothing)', { enforcement: 'evaluate' }],
    ['a branch target', { target: 'branch' }],
  ])('refuses %s', (_, patch) => {
    expect(neverMoveProblems({ ...good, ...patch })).not.toEqual([]);
  });
});

describe('drift between the files and GitHub', () => {
  const file: Ruleset = {
    name: 'r',
    target: 'tag',
    enforcement: 'active',
    bypass_actors: [],
    conditions: { ref_name: { exclude: [], include: ['refs/tags/v*'] } },
    rules: [{ type: 'deletion' }],
  };
  // What GET returns: the same ruleset with GitHub's own fields and keys in
  // another order.
  const live: Ruleset = {
    id: 1,
    node_id: 'x',
    created_at: '2026-10-14T00:00:00Z',
    current_user_can_bypass: 'never',
    _links: {},
    rules: [{ type: 'deletion' }],
    conditions: { ref_name: { include: ['refs/tags/v*'], exclude: [] } },
    bypass_actors: [],
    enforcement: 'active',
    target: 'tag',
    name: 'r',
  };

  it('ignores GitHub-only fields and key order', () => {
    expect(drift([file], [live])).toEqual([]);
  });

  it('reports a changed field by name', () => {
    expect(drift([file], [{ ...live, enforcement: 'disabled' }])).toEqual([
      '"r": differs on GitHub (fields: enforcement)',
    ]);
  });

  it('reports a bypass added on GitHub', () => {
    expect(drift([file], [{ ...live, bypass_actors: [ADMIN] }])).toEqual([
      '"r": differs on GitHub (fields: bypass_actors)',
    ]);
  });

  it('reports a ruleset missing on either side', () => {
    expect(drift([file], [])).toEqual(['"r": in the repo, not on GitHub']);
    expect(drift([], [live])).toEqual(['"r": on GitHub, not in the repo']);
  });

  it('refuses to compare when GitHub hides bypass_actors (gh not signed in as admin)', () => {
    const hidden: Ruleset = { ...live };
    delete hidden.bypass_actors;
    expect(drift([file], [hidden])).toEqual([
      '"r": GitHub hid bypass_actors; sign gh in as the repository admin',
    ]);
  });

  it('refuses a name used twice, in the files or on GitHub', () => {
    expect(drift([file, file], [live])).toEqual(['"r": more than one file has this name']);
    expect(drift([file], [live, { ...live, id: 2 }])).toEqual([
      '"r": more than one ruleset on GitHub has this name',
    ]);
  });

  it('treats rule order as a difference (GitHub keeps the order it was given)', () => {
    const two = { ...file, rules: [{ type: 'deletion' }, { type: 'update' }] };
    expect(drift([two], [{ ...live, rules: [{ type: 'update' }, { type: 'deletion' }] }])).toEqual([
      '"r": differs on GitHub (fields: rules)',
    ]);
  });
});
