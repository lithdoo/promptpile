import { checkCallsStatus, statusExitCode } from '../exec-calls/check-status';

export type CheckCliOptions = { input: string };

export async function runCheck(opts: CheckCliOptions): Promise<number> {
  const report = checkCallsStatus(opts.input);
  console.log(`status: ${report.status}`);
  console.log(`calls: ${report.calls}`);
  console.log(`results: ${report.results}`);
  console.log(`result: ${report.resultPath}`);
  if (report.missing.length > 0) {
    console.log(`missing: ${report.missing.join(', ')}`);
  }
  if (report.error) {
    console.error(`error: ${report.error}`);
  }
  return statusExitCode(report.status);
}
