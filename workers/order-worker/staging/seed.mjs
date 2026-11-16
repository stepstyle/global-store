// Seed the STAGING project with fully synthetic products + a staging marker.
//   node staging/seed.mjs --config staging/staging.config.json [--reset]
// --reset also deletes all documents in orders/ and orderLedger/ of the STAGING project.
// Nothing runs before the staging guard passes.

import { pathToFileURL } from 'node:url';
import { encodeFields } from '../src/firestore.js';
import { PRODUCTS } from '../test/fixtures.mjs';
import { parseArgs, prepareStaging, MARKER_PATH, runCli } from './common.mjs';

async function deleteAll(fs, collectionId) {
  let total = 0;
  for (;;) {
    const docs = await fs.runQuery({ from: [{ collectionId }], limit: 200 });
    if (docs.length === 0) return total;
    const r = await fs.commit(docs.map((d) => ({ delete: d.name })));
    if (!r.ok) throw new Error(`delete ${collectionId} failed (${r.status})`);
    total += docs.length;
  }
}

export async function main(argv, deps = {}) {
  const args = parseArgs(argv);
  const { st, fs } = prepareStaging({ configPath: args.config, ...deps });

  if (args.flags.has('reset')) {
    const o = await deleteAll(fs, 'orders');
    const l = await deleteAll(fs, 'orderLedger');
    console.log(`reset: deleted ${o} orders, ${l} ledger entries in ${st.projectId}`);
  }

  const writes = [
    { update: { name: fs.name(MARKER_PATH), fields: encodeFields({ project: st.projectId, purpose: 'staging-tests', syntheticDataOnly: true }) } },
    ...Object.entries(PRODUCTS).map(([id, data]) => ({ update: { name: fs.name(`products/${id}`), fields: encodeFields({ ...data, synthetic: true }) } })),
  ];
  const r = await fs.commit(writes);
  if (!r.ok) throw new Error(`seed failed (${r.status} ${r.data?.error?.status || ''})`);
  console.log(`seeded ${Object.keys(PRODUCTS).length} synthetic products + marker into ${st.projectId}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) runCli(main);
