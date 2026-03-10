export const notices: string[] = [];

export class TFile {
  constructor(public path: string) {}
}

export class Notice {
  constructor(message: string) {
    notices.push(message);
  }
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

export async function requestUrl(): Promise<never> {
  throw new Error("requestUrl mock was called unexpectedly");
}
