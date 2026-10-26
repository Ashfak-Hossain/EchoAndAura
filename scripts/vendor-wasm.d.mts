export type ZxingWasm = { source: string; version: string; sha256: string };
export function installedZxing(): Promise<ZxingWasm>;
export function copyZxingWasm(publicDir: string, zxing?: ZxingWasm): Promise<string>;
