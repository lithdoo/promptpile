#!/usr/bin/env node
import { runArchiveCli } from './cli';

void runArchiveCli(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
});
