import { test } from "node:test";
import assert from "node:assert/strict";
import { uploadBatch, type UploadResult } from "../lib/upload";
import { ApiError } from "../lib/api";
test("batch preserves selection order and continues after duplicates and failed files", async () => {
  const results: UploadResult[] = [],
    calls: string[] = [],
    progress: number[] = [];
  const files = ["first.mp3", "duplicate.mp3", "bad.mp3", "last.mp3"].map(
    (name) => new File(["audio"], name),
  );
  const request = async <T>(_path: string, options: RequestInit = {}) => {
    const name = (options.body as FormData).get("file") as File;
    calls.push(name.name);
    if (name.name === "duplicate.mp3") throw new ApiError("duplicate", 409);
    if (name.name === "bad.mp3") throw new Error("network error");
    return {} as T;
  };
  await uploadBatch(
    files,
    (r) => results.push(r),
    (i) => progress.push(i),
    request,
  );
  assert.deepEqual(
    calls,
    files.map((f) => f.name),
  );
  assert.deepEqual(
    results.map((r) => r.status),
    ["success", "duplicate", "error", "success"],
  );
  assert.deepEqual(progress, [0, 1, 2, 3]);
});
test("expired sessions stop the rest of an upload batch", async () => {
  let calls = 0;
  await assert.rejects(
    uploadBatch(
      [new File(["a"], "a.mp3"), new File(["b"], "b.mp3")],
      () => {},
      () => {},
      async () => {
        calls++;
        throw new ApiError("expired", 401);
      },
    ),
    /expired/,
  );
  assert.equal(calls, 1);
});
test("batch sends an explicit artist and leaves blank artists for MP3 metadata", async () => {
  const artists: (FormDataEntryValue | null)[] = [];
  const request = async <T>(_path: string, options: RequestInit = {}) => {
    artists.push((options.body as FormData).get("artist"));
    return {} as T;
  };
  const files = [new File(["audio"], "song.mp3")];
  await uploadBatch(files, () => {}, () => {}, request, "  خواننده  ");
  await uploadBatch(files, () => {}, () => {}, request, "   ");
  assert.deepEqual(artists, ["خواننده", null]);
});
