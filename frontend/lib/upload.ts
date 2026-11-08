import { api, ApiError, errorText } from "./api";
export type UploadResult = {
  name: string;
  status: "success" | "duplicate" | "error";
  message: string;
};
export async function uploadBatch(
  files: File[],
  onResult: (result: UploadResult, index: number) => void,
  onProgress: (index: number) => void,
  request = api,
  artist = "",
) {
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    onProgress(index);
    const form = new FormData();
    form.append("file", file);
    if (artist.trim()) form.append("artist", artist.trim());
    try {
      await request("/api/upload", { method: "POST", body: form });
      onResult(
        { name: file.name, status: "success", message: "به صف اضافه شد" },
        index,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) throw e;
      const duplicate = e instanceof ApiError && e.status === 409;
      onResult(
        {
          name: file.name,
          status: duplicate ? "duplicate" : "error",
          message: duplicate ? "قبلاً در صف یا در حال پخش است" : errorText(e),
        },
        index,
      );
    }
  }
}
