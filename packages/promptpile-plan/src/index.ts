#!/usr/bin/env node
import { parseCli } from './cli';

function main(): void {
  parseCli();
  process.stdout.write(
    'promptpile-plan: 脚手架已就绪；plan / exec 循环与子进程调用尚未接线。\n'
  );
}

try {
  main();
} catch (e) {
  console.error('Error:', e);
  process.exitCode = 1;
}
