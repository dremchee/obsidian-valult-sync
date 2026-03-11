import { describe, expect, it } from "vitest";

import { parseRealtimeSseBuffer } from "../sync/realtime";

describe("sync realtime", () => {
  it("parses SSE payloads and keeps trailing remainder", () => {
    const parsed = parseRealtimeSseBuffer(
      [
        "event: change",
        "data: {\"latest_seq\":2}",
        "",
        ": keepalive",
        "",
        "event: change",
        "data: {\"latest_seq\":3}",
      ].join("\n"),
    );

    expect(parsed.events).toEqual([{ latest_seq: 2 }]);
    expect(parsed.remainder).toContain("\"latest_seq\":3");
  });
});
