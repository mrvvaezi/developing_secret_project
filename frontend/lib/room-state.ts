import type { Message, RoomState, RoomEvent } from "./types";
export function mergeMessages(
  messages: Message[],
  event: RoomEvent,
): Message[] {
  if (event.type === "chat_history") return event.messages.slice(-100);
  if (event.type === "chat_deleted")
    return messages.filter((m) => !event.ids.includes(m.id));
  if (event.type === "chat_message")
    return [...messages.filter((m) => m.id !== event.message.id), event.message]
      .sort((a, b) => a.id - b.id)
      .slice(-100);
  return messages;
}
export function positionAt(
  state: RoomState | null,
  receivedAt: number,
  now: number,
) {
  if (!state?.current) return 0;
  return Math.min(
    state.current.duration,
    Math.max(
      0,
      state.position +
        (state.playing ? Math.max(0, now - receivedAt) / 1000 : 0),
    ),
  );
}
