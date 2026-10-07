import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const bindings = [
  'env_vars',
  'kv_namespaces',
  'r2_buckets',
  'd1_databases',
  'durable_object_namespaces',
  'hyperdrive_bindings',
  'services',
  'queue_producers',
  'ai_bindings',
  'vectorize_bindings',
  'mtls_certificates',
  'analytics_engine_datasets',
  'browsers',
];

export function validateProject(data) {
  const project = data?.result;
  if (
    data?.success !== true ||
    project?.name !== 'echoandaura-docs' ||
    project.production_branch !== 'main' ||
    project.source != null ||
    project.uses_functions === true
  )
    throw new Error('Expected the existing Terraform-managed static Direct Upload project');
  for (const environment of ['preview', 'production']) {
    const config = project.deployment_configs?.[environment];
    for (const key of bindings) {
      const value = config?.[key];
      if (value != null && Object.keys(value).length > 0)
        throw new Error('Docs project must have no environment secrets or runtime bindings');
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!/^[a-f0-9]{32}$/i.test(account) || !token)
    throw new Error('Configure the protected docs environment');
  // GET only. Never let the uploader create a project or delegate a missing
  // Pages project to Workers. Never print the account, token or response body.
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/echoandaura-docs`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) throw new Error('Cannot verify existing Pages project; no upload attempted');
  validateProject(await response.json());
  console.log('Existing static Pages project verified.');
}
