export function preserveSystemClipboard(): Promise<{ supported: true; formats: string[]; emptyPlainTextRoundTrip: boolean | null }>;
