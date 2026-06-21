import { Command } from 'commander';

export function parseCli(): void {
  const program = new Command();
  program
    .name('promptpile-plan')
    .description(
      'Plan-and-exec orchestration on top of the promptpile CLI (scaffold; not wired yet).'
    )
    .version('0.0.0')
    .helpOption('-h, --help', '显示帮助')
    .parse();
}
