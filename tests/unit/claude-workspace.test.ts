import { spawnSync } from 'node:child_process';
import {
  accessSync,
  constants,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The Claude Code workspace (.claude/README.md): the session meter, and the
// README agreeing with the commands, agents and scripts that exist.

const dir = mkdtempSync(join(tmpdir(), 'claude-workspace-'));
let files = 0;

type Line = { tokens?: number; sidechain?: boolean; type?: string } | string;
/** A fake transcript: one JSON object per line, as Claude Code writes them. */
const transcript = (...lines: Line[]) => {
  const path = join(dir, `t${files++}.jsonl`);
  const json = lines.map((line) =>
    typeof line === 'string'
      ? line
      : JSON.stringify({
          type: line.type ?? 'assistant',
          isSidechain: line.sidechain ?? false,
          message: {
            usage: {
              input_tokens: 2,
              cache_creation_input_tokens: 1_000,
              cache_read_input_tokens: (line.tokens ?? 0) - 1_002,
              output_tokens: 500,
            },
          },
        }),
  );
  writeFileSync(path, json.join('\n') + '\n');
  return path;
};

const run = (script: string, stdin: string, args: string[] = []) =>
  spawnSync('bash', [script, ...args], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: process.cwd() },
  });
const withTranscript = (path: string) => JSON.stringify({ transcript_path: path });

describe('context-tokens: the context size from the transcript', () => {
  const tokens = (path: string) => run('.claude/hooks/context-tokens.sh', '', [path]);

  it('sums input, cache creation and cache reads of the last main-thread turn', () => {
    const path = transcript({ tokens: 40_000 }, { type: 'user' }, { tokens: 95_321 });
    expect(tokens(path).stdout.trim()).toBe('95321');
  });

  it('ignores subagent turns, which have their own context', () => {
    const path = transcript({ tokens: 95_000 }, { tokens: 400_000, sidechain: true });
    expect(tokens(path).stdout.trim()).toBe('95000');
  });

  it('skips a line cut off mid-write', () => {
    const path = transcript({ tokens: 95_000 }, '{"type":"assistant","message":{"usa');
    expect(tokens(path).stdout.trim()).toBe('95000');
  });

  it.each([
    ['a missing file', join(dir, 'missing.jsonl')],
    ['no file at all', ''],
    ['no assistant turn yet', transcript({ type: 'user' })],
  ])('prints nothing for %s, without failing', (_, path) => {
    const result = tokens(path);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });
});

describe('statusline: warns before the context gets expensive', () => {
  const line = (stdin: string) => run('.claude/statusline.sh', stdin).stdout;

  it.each([
    [95_000, 'ctx 95k', ''],
    [130_000, 'ctx 130k · wrap up soon', ''],
    [190_000, 'ctx 190k · new session now', 'wrap up soon'],
  ])('at %i tokens shows "%s"', (count, shown, absent) => {
    const output = line(withTranscript(transcript({ tokens: count })));
    expect(output).toMatch(/^echo&aura/);
    expect(output).toContain(shown);
    if (absent) expect(output).not.toContain(absent);
  });

  it('leaves the size out when there is no transcript or no input', () => {
    expect(line('{}')).not.toContain('ctx');
    expect(line('')).not.toContain('ctx');
  });
});

describe('session-size: past 150k, Claude is told to close the session', () => {
  const hook = (stdin: string) => run('.claude/hooks/session-size.sh', stdin);

  it('says nothing below the limit', () => {
    const result = hook(withTranscript(transcript({ tokens: 149_999 })));
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('adds the wrap-up instruction to the prompt at the limit', () => {
    const result = hook(withTranscript(transcript({ tokens: 162_400 })));
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(output.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(output.hookSpecificOutput.additionalContext).toContain('162k');
    expect(output.hookSpecificOutput.additionalContext).toContain('RESUME HERE');
    expect(output.hookSpecificOutput.additionalContext).toContain('/clear and then /prime');
  });

  it.each([
    ['a missing transcript', withTranscript(join(dir, 'missing.jsonl'))],
    ['input that is not JSON', 'not json'],
    ['a large subagent only', withTranscript(transcript({ tokens: 400_000, sidechain: true }))],
  ])('never blocks the prompt on %s', (_, stdin) => {
    const result = hook(stdin);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });
});

describe('the workspace matches its README', () => {
  const readme = readFileSync('.claude/README.md', 'utf8');
  const names = (folder: string, ext: string) =>
    readdirSync(folder)
      .filter((file) => file.endsWith(ext))
      .map((file) => file.slice(0, -ext.length))
      .sort();
  const frontmatter = (path: string) => {
    const block = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(path, 'utf8'))?.[1] ?? '';
    return Object.fromEntries(
      block
        .split('\n')
        .map((row) => /^([a-z-]+):\s*(.*)$/.exec(row))
        .filter((match) => match !== null)
        .map((match) => [match[1], match[2]]),
    );
  };
  const tableNames = (heading: string, pattern: RegExp) => {
    const section = readme.split(`## ${heading}\n`)[1]?.split('\n## ')[0] ?? '';
    return [...section.matchAll(pattern)].map((match) => match[1]).sort();
  };

  it('lists exactly the commands that exist, each with a description', () => {
    const commands = names('.claude/commands', '.md');
    expect(tableNames('Commands', /^\| `\/([a-z-]+)/gm)).toEqual(commands);
    for (const command of commands) {
      expect(frontmatter(`.claude/commands/${command}.md`).description).toBeTruthy();
    }
  });

  it('lists exactly the agents that exist; each is named after its file and only reads', () => {
    const agents = names('.claude/agents', '.md');
    expect(tableNames('Reviewers', /^\| `([a-z-]+)`/gm)).toEqual(agents);
    for (const agent of agents) {
      const fields = frontmatter(`.claude/agents/${agent}.md`);
      expect(fields.name).toBe(agent);
      expect(fields.description).toBeTruthy();
      expect(fields.tools?.split(/,\s*/).sort()).toEqual(['Bash', 'Glob', 'Grep', 'Read']);
    }
  });

  it('maps every hook and script, and each is executable', () => {
    const scripts = [
      ...names('.claude/hooks', '.sh').map((name) => `hooks/${name}.sh`),
      ...names('.claude/scripts', '.sh').map((name) => `scripts/${name}.sh`),
      'statusline.sh',
    ];
    for (const script of scripts) {
      expect(readme).toContain(script.split('/').pop());
      expect(() => accessSync(`.claude/${script}`, constants.X_OK)).not.toThrow();
    }
  });

  it('runs the session meter on every prompt', () => {
    const settings = JSON.parse(readFileSync('.claude/settings.json', 'utf8')) as {
      hooks: Record<string, { hooks: { command: string }[] }[]>;
    };
    expect(settings.hooks.UserPromptSubmit?.[0]?.hooks[0]?.command).toBe(
      '$CLAUDE_PROJECT_DIR/.claude/hooks/session-size.sh',
    );
  });
});

describe('the production commands only read', () => {
  // /prod-check and /event-ready run these blocks as written; the Bash guard
  // (ADR-072) must let every one through, or the command fails mid-report.
  it.each(['prod-check', 'event-ready'])('/%s passes the Bash guard', (command) => {
    const text = readFileSync(`.claude/commands/${command}.md`, 'utf8');
    const blocks = [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map((match) => match[1]);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const result = run(
        '.claude/hooks/guard-bash.sh',
        JSON.stringify({ tool_input: { command: block } }),
      );
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
    }
  });
});

describe('check-images.sh', () => {
  it.each([
    ['no commit', []],
    ['a version without the v', ['HEAD', '1.1.0']],
  ])('refuses %s before any network call', (_, args) => {
    const result = run('.claude/scripts/check-images.sh', '', args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('usage: check-images.sh');
  });
});
