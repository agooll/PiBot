import type { ImageContent } from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";
import { requeue, SessionAdditions } from "../src/session/session-additions.ts";

it("keeps the SDK delivery order when moving one queued input", async () => {
  const additions = new SessionAdditions();
  const images: ImageContent[] = [{ type: "image", data: "AA==", mimeType: "image/png" }];
  additions.queued.set("second", { text: "second", mode: "steer" });
  additions.queued.set("moved", { text: "move me", mode: "followUp", images });
  additions.queued.set("first", { text: "first", mode: "steer" });
  additions.queued.set("in-flight", { text: "already consumed", mode: "followUp" });
  const sdk = {
    clearQueue: vi.fn(() => ({
      steering: ["first", "sdk input", "second"],
      followUp: ["stay", "move me", "sdk follow-up"],
    })),
    steer: vi.fn(async (_text: string, _images?: ImageContent[]) => undefined),
    followUp: vi.fn(async (_text: string, _images?: ImageContent[]) => undefined),
  };

  expect(await requeue(additions, sdk, "moved", "steer")).toBe(true);
  expect(sdk.steer.mock.calls.map(([text]) => text)).toEqual([
    "first",
    "sdk input",
    "second",
    "move me",
  ]);
  expect(sdk.steer).toHaveBeenLastCalledWith("move me", images);
  expect(sdk.followUp.mock.calls.map(([text]) => text)).toEqual(["stay", "sdk follow-up"]);
  expect(additions.queued.get("moved")?.mode).toBe("steer");
});
