import { expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runInThisContext } from 'node:vm';
import { build } from 'esbuild';
import { SentryCli } from '@sentry/cli';
import { NodeClient, defaultStackParser } from '@sentry/node';
import { serializeEnvelope, type Envelope, type Event } from '@sentry/core';
import { errorTrackingOptions, privateTransport } from '@/lib/error-tracking/privacy';
import { normalizeMapReferences } from '../../scripts/error-tracking-build.mjs';

it.each(['3n3-t71sg89d-.js', '[root-of-the-server]__fixture(public).js'])(
  'matches an injected %s source-map ID through the privacy boundary offline',
  async (filename) => {
    const directory = await mkdtemp(join(tmpdir(), 'echoandaura-private-map-'));
    const output = join(directory, '.next-build/server/chunks', filename);
    const privateMessage = 'synthetic-buyer@example.com 01712345678 AB12CD34E5';
    let client: NodeClient | undefined;
    try {
      await mkdir(join(directory, '.next-build/server/chunks'), { recursive: true });
      await build({
        stdin: {
          contents: `throw new Error(${JSON.stringify(privateMessage)});`,
          sourcefile: 'synthetic-fixture.ts',
        },
        bundle: true,
        platform: 'node',
        format: 'iife',
        sourcemap: 'linked',
        outfile: output,
      });
      const source = await readFile(output, 'utf8');
      await writeFile(
        output,
        source.replace(`${filename}.map`, `${encodeURIComponent(filename)}.map`),
      );
      await normalizeMapReferences(join(directory, '.next-build/server'));
      // Injection is entirely local: this test never calls the upload command.
      await promisify(execFile)(SentryCli.getPath(), [
        'sourcemaps',
        'inject',
        join(directory, '.next-build/server'),
      ]);
      const map: { debugId?: string } = JSON.parse(await readFile(`${output}.map`, 'utf8'));
      expect(map.debugId).toMatch(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
      const outgoing: Envelope[] = [];
      client = new NodeClient({
        ...errorTrackingOptions('web', 'b'.repeat(40)),
        dsn: `https://${'a'.repeat(32)}@o123.ingest.us.sentry.io/123`,
        stackParser: defaultStackParser,
        integrations: [],
        transport: () =>
          privateTransport({
            send: async (envelope) => {
              outgoing.push(envelope);
              return { statusCode: 200 };
            },
            flush: async () => true,
          }),
      });
      try {
        runInThisContext(await readFile(output, 'utf8'), { filename: output });
        throw new Error('Synthetic fixture did not throw');
      } catch (error) {
        client.captureException(error);
      }
      await client.flush(1000);
      expect(outgoing).toHaveLength(1);
      const event = outgoing[0]![1][0]?.[1] as Event;
      const canonical = `app:///next/${map.debugId}.js`;
      expect(event.debug_meta?.images).toContainEqual({
        type: 'sourcemap',
        code_file: canonical,
        debug_id: map.debugId,
      });
      expect(event.exception?.values?.[0]?.stacktrace?.frames).toContainEqual(
        expect.objectContaining({ filename: canonical, lineno: expect.any(Number) }),
      );
      const wire = serializeEnvelope(outgoing[0]!);
      expect(wire).not.toContain(privateMessage);
      expect(wire).not.toContain(directory);
      expect(wire).not.toContain('synthetic-fixture');
    } finally {
      await client?.close(1000);
      // Only the exact freshly allocated fixture directory is removed.
      await rm(directory, { recursive: true, force: true });
    }
  },
);
