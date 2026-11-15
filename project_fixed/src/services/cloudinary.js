const cloudinary = require("cloudinary").v2;
const config = require("../config");
const logger = require("../logger");

const CLOUDINARY_TIMEOUT_MS = 20000;

cloudinary.config({
  cloud_name: config.CLOUDINARY_CLOUD_NAME,
  api_key: config.CLOUDINARY_API_KEY,
  api_secret: config.CLOUDINARY_API_SECRET,
  timeout: CLOUDINARY_TIMEOUT_MS,
});

async function withCloudinaryRetry(operationName, operation) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let timer;
    try {
      return await Promise.race([
        operation(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Cloudinary request timed out.")), CLOUDINARY_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      lastError = error;
      logger.warn({ operation: operationName, attempt: attempt + 1, error: error.message }, "Cloudinary request failed");
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function uploadCard(image, userId) {
  return withCloudinaryRetry("upload", () =>
    cloudinary.uploader.upload(image, {
        folder: "good-morning-ai",
        resource_type: "image",
        context: { user_id: String(userId) },
        timeout: CLOUDINARY_TIMEOUT_MS,
      }),
  );
}

async function listUserCards(userId) {
  const result = await withCloudinaryRetry("history", () =>
    cloudinary.api.resources_by_context("user_id", String(userId), {
      type: "upload",
      prefix: "good-morning-ai",
      max_results: 100,
      resource_type: "image",
      timeout: CLOUDINARY_TIMEOUT_MS,
    }),
  );
  return (result.resources || [])
    .filter((resource) => resource.context?.custom?.user_id === String(userId))
    .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
    .map((resource) => ({
      url: resource.secure_url,
      createdAt: resource.created_at,
      publicId: resource.public_id,
    }));
}

async function deleteUserCards(userId) {
  let nextCursor;
  do {
    const result = await withCloudinaryRetry("account card listing", () =>
      cloudinary.api.resources_by_context("user_id", String(userId), {
        type: "upload",
        prefix: "good-morning-ai",
        max_results: 100,
        resource_type: "image",
        next_cursor: nextCursor,
        timeout: CLOUDINARY_TIMEOUT_MS,
      }),
    );
    const publicIds = (result.resources || [])
      .filter((resource) => resource.context?.custom?.user_id === String(userId))
      .map((resource) => resource.public_id);
    for (let offset = 0; offset < publicIds.length; offset += 10) {
      const batch = publicIds.slice(offset, offset + 10);
      await Promise.all(batch.map((publicId) =>
        withCloudinaryRetry("card deletion", () =>
          cloudinary.uploader.destroy(publicId, {
            resource_type: "image",
            timeout: CLOUDINARY_TIMEOUT_MS,
          }),
        ),
      ));
    }
    nextCursor = result.next_cursor;
  } while (nextCursor);
}

module.exports = { deleteUserCards, listUserCards, uploadCard, withCloudinaryRetry };
