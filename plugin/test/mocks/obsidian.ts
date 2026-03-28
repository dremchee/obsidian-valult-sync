export const notices: string[] = [];

export class TFile {
  path: string;

  constructor(path: string) {
    this.path = path;
  }
}

export class Notice {
  constructor(message: string) {
    notices.push(message);
  }
}

export class Modal {
  app: unknown;
  modalEl = {
    addClass() {},
  };
  titleEl = {
    setText() {},
  };
  contentEl = {
    empty() {},
  };

  constructor(app: unknown) {
    this.app = app;
  }

  open(): void {}

  close(): void {}
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

export async function requestUrl(): Promise<never> {
  throw new Error("requestUrl mock was called unexpectedly");
}
