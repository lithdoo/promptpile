import type { OutputPileWriter } from './output-pile';
import { recordSecondaryFailure } from './primary-failure';

/** Own the required output-pile lifecycle while preserving the first primary failure. */
export const runModelOutputLifecycle = async <T>(options: {
  outputPile: OutputPileWriter;
  runModel: () => Promise<T>;
}): Promise<T> => {
  const { outputPile, runModel } = options;
  let ready = false;
  let hasPrimaryFailure = false;
  let primaryFailure: unknown;
  let result!: T;

  try {
    await outputPile.ready();
    ready = true;
    result = await runModel();
    outputPile.writeDone();
  } catch (error) {
    hasPrimaryFailure = true;
    primaryFailure = error;
    if (ready) {
      try {
        outputPile.writeError(error);
      } catch (secondary) {
        recordSecondaryFailure(primaryFailure, secondary);
      }
    }
  }

  try {
    await outputPile.close();
  } catch (closeError) {
    if (hasPrimaryFailure) recordSecondaryFailure(primaryFailure, closeError);
    else {
      hasPrimaryFailure = true;
      primaryFailure = closeError;
    }
  }

  if (hasPrimaryFailure) throw primaryFailure;
  return result;
};
