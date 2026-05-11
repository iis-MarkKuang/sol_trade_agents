import { describe, expect, it } from "vitest";
import { parseHermesPayload } from "../oracle/pyth-price-feed.js";

describe("parseHermesPayload", () => {
  it("normalizes Hermes parsed price updates and validates confidence", () => {
    const payload = {
      parsed: [
        {
          id: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
          price: {
            price: "16000000000",
            conf: "8000000",
            expo: -8,
            publish_time: Math.floor(Date.now() / 1000)
          }
        }
      ],
      binary: { data: ["vaa"] }
    };

    const updates = parseHermesPayload(payload, { staleMs: 15_000, maxConfidenceBps: 75 });
    const update = updates.get("0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d");

    expect(update?.price).toBe(160);
    expect(update?.confidenceBps).toBeLessThan(75);
    expect(update?.vaa).toBe("vaa");
  });
});
