import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeMessages, positionAt } from "../lib/room-state";
import type { Message, RoomState } from "../lib/types";
const message = (id: number): Message => ({
  id,
  name: "سارا",
  text: "سلام",
  created_at: 1,
});
test("chat stays ordered, deduplicates delivery and applies deletion", () => {
  let messages = mergeMessages([message(2)], {
    type: "chat_message",
    message: message(1),
  });
  messages = mergeMessages(messages, {
    type: "chat_message",
    message: message(2),
  });
  assert.deepEqual(
    messages.map((m) => m.id),
    [1, 2],
  );
  assert.deepEqual(
    mergeMessages(messages, { type: "chat_deleted", ids: [1] }).map(
      (m) => m.id,
    ),
    [2],
  );
});
test("reconnect history replaces old messages and retains at most 100", () => {
  const result = mergeMessages([message(500)], {
    type: "chat_history",
    messages: Array.from({ length: 120 }, (_, i) => message(i)),
  });
  assert.equal(result.length, 100);
  assert.equal(result[0].id, 20);
  assert.equal(result.at(-1)?.id, 119);
});
test("playback follows monotonic elapsed time and clamps track duration", () => {
  const state = {
    current: { duration: 60 },
    playing: true,
    position: 10,
  } as RoomState;
  assert.equal(positionAt(state, 1000, 5000), 14);
  assert.equal(positionAt({ ...state, playing: false }, 1000, 5000), 10);
  assert.equal(positionAt(state, 1000, 100000), 60);
  assert.equal(positionAt(null, 1000, 5000), 0);
});
