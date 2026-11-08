export type User = {
  id: number;
  name: string;
  is_admin: boolean;
  active?: boolean;
};
export type Track = {
  id: string;
  title: string;
  uploader: string;
  artist?: string;
  duration: number;
  url: string;
  uploaded_at?: number;
  event_id?: number;
  started_at?: number;
  ended_at?: number;
  outcome?: string;
};
export type Reaction = "fire" | "love" | "skip";
export type SiteCopy = { hero_title: string; hero_cover?: string; hero_text_color?: string; hero_accent_color?: string };
export type RoomState = {
  type: "state";
  server_time: number;
  current: Track | null;
  position: number;
  playing: boolean;
  shuffle: boolean;
  play_id: number | null;
  reactions: Record<Reaction, number>;
  queue: Track[];
  listeners: number;
  library_revision: number;
  history_revision: string;
  site_copy: SiteCopy;
};
export type Message = {
  id: number;
  name: string;
  text: string;
  created_at: number;
};
export type RoomEvent =
  | RoomState
  | { type: "chat_history"; messages: Message[] }
  | { type: "chat_message"; message: Message }
  | { type: "chat_deleted"; ids: number[] }
  | { type: "track_deleted"; id: string };
export type Collection = { items: Track[]; total: number };
export type OnlineUser = User & {
  connections: { device: string; os: string; browser: string }[];
};
export type Report = {
  title: string;
  track_id: string;
  play_id: number;
  name: string;
  reaction: Reaction;
};

export type Playlist = { id: number; name: string; count: number };
