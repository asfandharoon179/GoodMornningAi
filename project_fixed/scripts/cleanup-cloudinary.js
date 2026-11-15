const cloudinary = require("cloudinary").v2;
const config = require("../src/config");
const logger = require("../src/logger");
const { withCloudinaryRetry } = require("../src/services/cloudinary");

function readDays(args) {
  const option = args.find((value) => value.startsWith("--days="));
  const days = option ? Number(option.slice("--days=".length)) : 365;
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new Error("--days must be an integer between 1 and 3650.");
  }
  return days;
}

async function findOldCards(cutoff) {
  const cards = [];
  let nextCursor;
  do {
    const result = await withCloudinaryRetry("cleanup listing", () =>
      cloudinary.api.resources({
        type: "upload",
        prefix: "good-morning-ai",
        resource_type: "image",
        max_results: 100,
        next_cursor: nextCursor,
        timeout: 20000,
      }),
    );
    for (const resource of result.resources || []) {
      if (new Date(resource.created_at) < cutoff) cards.push(resource.public_id);
    }
    nextCursor = result.next_cursor;
  } while (nextCursor);
  return cards;
}

async function main() {
  const days = readDays(process.argv.slice(2));
  const confirmed = process.argv.includes("--confirm");
  cloudinary.config({
    cloud_name: config.CLOUDINARY_CLOUD_NAME,
    api_key: config.CLOUDINARY_API_KEY,
    api_secret: config.CLOUDINARY_API_SECRET,
    timeout: 20000,
  });
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const publicIds = await findOldCards(cutoff);
  logger.info({ count: publicIds.length, days }, confirmed ? "Cloudinary cleanup candidates found" : "Dry run; no cards deleted");
  if (!confirmed) {
    logger.info("Run again with --confirm to delete these cards.");
    return;
  }

  for (let offset = 0; offset < publicIds.length; offset += 10) {
    await Promise.all(publicIds.slice(offset, offset + 10).map((publicId) =>
      withCloudinaryRetry("cleanup deletion", () =>
        cloudinary.uploader.destroy(publicId, { resource_type: "image", timeout: 20000 }),
      ),
    ));
  }
  logger.info({ deleted: publicIds.length }, "Cloudinary cleanup completed");
}

main().catch((error) => {
  logger.error({ error: error.message }, "Cloudinary cleanup failed");
  process.exitCode = 1;
});
