const fs = require('fs/promises');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BACKUP_DIR = path.join(ROOT, 'backups', 'appwrite-2026-04-18');
const STORAGE_DIR = path.join(BACKUP_DIR, 'storage');
const OUT_DIR = path.join(ROOT, 'worker', 'import-sql');
const MAP_FILE = path.join(OUT_DIR, 'r2-import-map.json');
const BUCKET_NAME = 'crownzcom-files';

const envAccountId = process.env.CF_ACCOUNT_ID;
const envApiToken = process.env.CF_API_TOKEN;

const buckets = ['documents', 'branding'];

const loadJson = async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8'));

const findLocalFilePath = async (bucket, fileId) => {
  const dir = path.join(STORAGE_DIR, bucket, 'files');
  const files = await fs.readdir(dir).catch(() => []);
  const match = files.find((entry) => entry.startsWith(`${fileId}__`));
  return match ? path.join(dir, match) : path.join(dir, `${fileId}__${fileId}`);
};

const buildObjectKey = (bucket, file) => `${bucket}/${file.$id}`;

const uploadObject = async (bucketName, objectKey, filePath, contentType) => {
  if (!envAccountId || !envApiToken) {
    throw new Error('CF_ACCOUNT_ID and CF_API_TOKEN must be set to upload files into R2');
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${envAccountId}/r2/buckets/${bucketName}/objects/${encodeURIComponent(objectKey)}`;
  const fileData = await fs.readFile(filePath);
  const headers = {
    Authorization: `Bearer ${envApiToken}`,
    'Content-Type': contentType || 'application/octet-stream',
    'Content-Length': String(fileData.length),
  };

  const res = await fetch(url, {
    method: 'PUT',
    headers,
    body: fileData,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`R2 upload failed for ${objectKey}: ${res.status} ${res.statusText} ${body}`);
  }
  return true;
};

const ensureOutputDir = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });
};

const main = async () => {
  const command = process.argv[2];
  const doUpload = command === '--upload';
  const doMapOnly = command === '--generate-mapping' || !command;

  await ensureOutputDir();

  const results = [];

  for (const bucket of buckets) {
    const metadataPath = path.join(STORAGE_DIR, bucket, 'files.json');
    const metadata = await loadJson(metadataPath).catch((err) => {
      throw new Error(`Unable to read metadata for bucket '${bucket}': ${err.message}`);
    });

    for (const file of metadata) {
      const objectKey = buildObjectKey(bucket, file);
      const localFilePath = await findLocalFilePath(bucket, file.$id);
      const exists = await fs
        .access(localFilePath)
        .then(() => true)
        .catch(() => false);

      if (!exists) {
        console.warn(`Warning: missing file for ${bucket}/${file.$id} at resolved path ${localFilePath}`);
      }
      const entry = {
        bucket,
        fileId: file.$id,
        name: file.name,
        objectKey,
        contentType: file.mimeType || 'application/octet-stream',
        sizeBytes: file.sizeOriginal ?? null,
        localPath: localFilePath,
        uploaded: false,
      };

      if (doUpload) {
        if (!exists) {
          entry.error = 'missing_local_file';
        } else {
          try {
            await uploadObject(BUCKET_NAME, objectKey, localFilePath, entry.contentType);
            entry.uploaded = true;
          } catch (err) {
            entry.error = String(err);
          }
        }
      }

      results.push(entry);
    }
  }

  await fs.writeFile(MAP_FILE, JSON.stringify(results, null, 2), 'utf8');
  console.log(`Wrote mapping file: ${MAP_FILE}`);
  const uploadedCount = results.filter((item) => item.uploaded).length;
  console.log(`Total files processed: ${results.length}, uploaded: ${uploadedCount}`);
  if (doUpload) {
    const failed = results.filter((item) => item.uploaded === false && !item.error?.startsWith('missing_local_file'));
    if (failed.length > 0) {
      console.warn(`Upload completed with ${failed.length} failures. See ${MAP_FILE}`);
    }
  } else {
    console.log('Run with `node scripts/migrate-appwrite-r2.cjs --upload` once CF_ACCOUNT_ID and CF_API_TOKEN are set.');
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
