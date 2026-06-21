#!/usr/bin/env node
import { parseCli } from './cli';

async function main(): Promise<void> {
  const code = await parseCli();
  process.exit(code);
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
