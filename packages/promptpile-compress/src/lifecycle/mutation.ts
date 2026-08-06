export type LifecycleMutationPoint =
  | 'create_staging'
  | 'move_to_staging'
  | 'write_manifest'
  | 'write_staged_summary'
  | 'commit_archive'
  | 'write_live_summary'
  | 'rollback_staging_file'
  | 'remove_staging'
  | 'delete_live_summary'
  | 'restore_message'
  | 'remove_archive';

export interface LifecycleMutationEvent {
  point: LifecycleMutationPoint;
  phase: 'before' | 'after';
  sourcePath?: string;
  targetPath?: string;
}

export type LifecycleMutationHook = (
  event: LifecycleMutationEvent
) => void | Promise<void>;

export const runLifecycleMutation = async <T>(
  hook: LifecycleMutationHook | undefined,
  event: Omit<LifecycleMutationEvent, 'phase'>,
  mutation: () => Promise<T>
): Promise<T> => {
  await hook?.({ ...event, phase: 'before' });
  const result = await mutation();
  await hook?.({ ...event, phase: 'after' });
  return result;
};
