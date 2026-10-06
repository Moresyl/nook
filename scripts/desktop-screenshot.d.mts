export function captureDesktopScreenshot(application: { evaluateMain(expression: string): Promise<{ png: string; size: number[] }> }, path: string): Promise<void>;
