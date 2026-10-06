export function documentBytes(format: string, options?: { outline?: boolean }): Buffer;
export function imageBytes(format?: 'png' | 'jpeg' | 'webp' | 'gif', width?: number, height?: number): Promise<Buffer>;
