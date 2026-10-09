import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const DEFAULT_ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export interface UploadImageOptions {
  formData: FormData;
  bucket: string;
  folder: string;
  entityId?: string;
  allowedTypes?: string[];
  maxSizeBytes?: number;
  entityLabel?: string;
}

export type UploadImageResult =
  | { ok: true; url: string | null | undefined }
  | { ok: false; message: string };

/**
 * Shared helper for image validation, upload to Supabase Storage, and URL fallback.
 */
export async function processImageUpload({
  formData,
  bucket,
  folder,
  entityId,
  allowedTypes = DEFAULT_ALLOWED_IMAGE_TYPES,
  maxSizeBytes = MAX_IMAGE_SIZE_BYTES,
  entityLabel,
}: UploadImageOptions): Promise<UploadImageResult> {
  if (formData.get("removePicture") === "true") {
    return { ok: true, url: null };
  }

  const file = formData.get("picture");
  if (
    file &&
    typeof file === "object" &&
    "size" in file &&
    (file as File).size > 0
  ) {
    const f = file as File;
    if (f.size > maxSizeBytes) {
      return {
        ok: false,
        message: entityLabel
          ? `${entityLabel} image must be 5MB or smaller.`
          : "Image must be 5MB or smaller.",
      };
    }
    if (!allowedTypes.includes(f.type)) {
      return {
        ok: false,
        message: entityLabel
          ? `${entityLabel} image must be a supported format.`
          : "Image must be JPEG, PNG, WebP, or GIF format.",
      };
    }

    const ext = f.name.split(".").pop()?.toLowerCase() || "png";
    const fileId = entityId ?? crypto.randomUUID();
    const filePath = `${folder}/${fileId}-${Date.now()}.${ext}`;

    const serviceRole = createServiceRoleClient();
    const arrayBuffer = await f.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await serviceRole.storage
      .from(bucket)
      .upload(filePath, buffer, {
        contentType: f.type,
        upsert: true,
      });

    if (uploadError) {
      return {
        ok: false,
        message: entityLabel
          ? `Failed to upload ${entityLabel.toLowerCase()} image. Please try again.`
          : "Failed to upload image. Please try again.",
      };
    }

    const { data: urlData } = serviceRole.storage
      .from(bucket)
      .getPublicUrl(filePath);

    return { ok: true, url: urlData.publicUrl };
  }

  const pictureUrlRaw = formData.get("pictureUrl");
  if (typeof pictureUrlRaw === "string") {
    const trimmed = pictureUrlRaw.trim();
    if (trimmed !== "") {
      try {
        new URL(trimmed);
        return { ok: true, url: trimmed };
      } catch {
        return { ok: false, message: "Please provide a valid image URL." };
      }
    }
  }

  return { ok: true, url: undefined };
}
