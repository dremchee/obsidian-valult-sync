import type { LoroDoc as LoroDocType } from "loro-crdt/nodejs";

import { getLoroDoc } from "@/loro-runtime";

import { base64ToBytes, bytesToBase64 } from "./payload-codec";

const CONTENT_KEY = "content";

export function createDocFromMarkdown(markdown: string, snapshotB64?: string): LoroDocType {
  const LoroDoc = getLoroDoc();
  const doc = new LoroDoc();
  if (snapshotB64) {
    doc.import(base64ToBytes(snapshotB64));
  }

  const text = doc.getText(CONTENT_KEY);
  if (text.toString() !== markdown) {
    replaceText(text, markdown);
    doc.commit();
  }

  return doc;
}

export function readMarkdownFromDoc(doc: LoroDocType): string {
  return doc.getText(CONTENT_KEY).toString();
}

export function exportSnapshotB64(doc: LoroDocType): string {
  const snapshot = doc.export({ mode: "snapshot" });
  return bytesToBase64(snapshot);
}

export function importSnapshotB64(snapshotB64: string): LoroDocType {
  const LoroDoc = getLoroDoc();
  const doc = new LoroDoc();
  doc.import(base64ToBytes(snapshotB64));
  return doc;
}

function replaceText(text: { toString: () => string; delete: (index: number, len: number) => void; insert: (index: number, value: string) => void }, next: string): void {
  const current = text.toString();
  if (current.length > 0) {
    text.delete(0, current.length);
  }
  if (next.length > 0) {
    text.insert(0, next);
  }
}
