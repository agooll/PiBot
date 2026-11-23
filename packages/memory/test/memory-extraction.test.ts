import { DatabaseSync } from "node:sqlite";
import { BotsRepo, ConversationsRepo, MessagesRepo, runMigrations } from "@pibot/storage";
import { expect, it } from "vitest";
import { extractionSource } from "../src/brain/memory-extraction.ts";

it("includes a bounded excerpt of an oversized user message before advancing coverage", () => {
  const db = new DatabaseSync(":memory:");
  try {
    runMigrations(db);
    const bot = new BotsRepo(db).ensureMainBot();
    const conversation = new ConversationsRepo(db).create({ botId: bot.id });
    const messages = new MessagesRepo(db);
    const send = (content: string) =>
      messages.create({ conversationId: conversation.id, role: "user", status: "done", content });

    send("Before");
    send(`Decision worth remembering ${"测🙂".repeat(12_000)}`);
    const after = send("After");

    const first = extractionSource(db, conversation.id, null);
    expect(first?.watermarkId).toBe(after.id);
    expect(first?.truncated).toBe(true);
    expect(first?.messageCount).toBe(3);
    const lines = first?.text.split("\n\n") ?? [];
    expect(lines[0]).toBe("User: Before");
    expect(lines[1]).toMatch(/^User: Decision worth remembering [测🙂]+\n\[message truncated\]$/u);
    expect(lines[1]?.isWellFormed()).toBe(true);
    expect(lines[2]).toBe("User: After");
    const cost = lines.reduce((total, line) => {
      const units = Array.from(line).reduce(
        (sum, point) => sum + ((point.codePointAt(0) ?? 0) > 127 ? 4 * point.length : 1),
        0,
      );
      return total + Math.ceil(units / 4) + 4;
    }, 0);
    expect(cost).toBeLessThanOrEqual(12_000);

    const latest = send("New turn");
    const second = extractionSource(db, conversation.id, after.id);
    expect(second?.text).toBe("User: New turn");
    expect(second?.truncated).toBe(false);

    const oversized = send("A".repeat(60_000));
    const third = extractionSource(db, conversation.id, latest.id);
    expect(third?.messageCount).toBe(1);
    expect(third?.subjectMessageId).toBe(oversized.id);
    expect(third?.text.endsWith("[message truncated]")).toBe(true);
  } finally {
    db.close();
  }
}, 30_000);
