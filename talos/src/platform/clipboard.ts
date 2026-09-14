export const copyTextToClipboard = async (text: string): Promise<boolean> => {
    if (!text || typeof navigator === 'undefined' || !navigator.clipboard) {
        return false;
    }

    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
};
