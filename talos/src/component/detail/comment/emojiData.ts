import { getResourceUrl } from '@/services/assets/resource';

export const COMMENT_EMOJI_IDS = Array.from({ length: 38 }, (_, index) => (
    String(index + 1).padStart(3, '0')
));

export const commentEmojiToken = (id: string): string => `:sns_${id}:`;

export const getCommentEmojiUrl = (id: string): string | undefined => (
    COMMENT_EMOJI_IDS.includes(id) ? getResourceUrl('emoji', `sns_emoji_${id}`) : undefined
);
