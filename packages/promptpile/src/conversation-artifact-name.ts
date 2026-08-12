import {
  classifyConversationArtifactNameV1,
  type RecognizedConversationArtifactNameV1
} from 'promptpile-protocol/conversation';

export type RecognizedConversationArtifactName = RecognizedConversationArtifactNameV1;

/** The single filename classifier shared by the scanner and output-policy preflight. */
export const classifyConversationArtifactName = (
  basename: string
): RecognizedConversationArtifactName | undefined =>
  classifyConversationArtifactNameV1(basename);
