// Shared helpers for staging scripts. Every entry point: parse args -> assertStagingConfig -> guardedFetch.

import { readFileSync } from 'node:fs';
import { Firestore } from '../src/firestore.js';
import { assertStagingConfig, guardedFetch, loadStagingConfigFile, StagingGuardError } from './guard.mjs';

export function parseArgs(argv) {
  const out = { flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else out.flags.add(key);
  }
  return out;
}

/**
 * Loads + validates config, installs the guarded fetch globally for this process,
 * and returns { st, fs } where fs is a Firestore client bound to the STAGING project.
 */
export function prepareStaging({ configPath, config, env = process.env, requireTokens = false, realFetch = globalThis.fetch }) {
  const raw = config ?? loadStagingConfigFile(configPath);
  const st = assertStagingConfig(raw, { env, requireTokens });
  // STAGING_ACCESS_TOKEN (order Worker gate) is read from the local environment only — never from a file sent to a browser
  const fetchImpl = guardedFetch(st, realFetch, { stagingAccessToken: String(env.STAGING_ACCESS_TOKEN || '') });
  globalThis.fetch = fetchImpl;

  const key = JSON.parse(readFileSync(st.serviceAccountKeyPath, 'utf8'));
  const fs = new Firestore({
    projectId: st.projectId,
    firestoreAuth: 'service-account',
    urls: { firestore: 'https://firestore.googleapis.com/v1', oauth: 'https://oauth2.googleapis.com/token' },
    serviceAccount: { clientEmail: key.client_email, privateKey: key.private_key },
  });
  return { st, fs, fetch: fetchImpl };
}

export const MARKER_PATH = 'stagingMarker/marker';

export async function runCli(main) {
  try {
    const code = await main(process.argv.slice(2));
    process.exitCode = code ?? 0;
  } catch (e) {
    if (e instanceof StagingGuardError) console.error(e.message);
    else console.error(`ERROR: ${e?.message || e}`);
    process.exitCode = 2;
  }
}
