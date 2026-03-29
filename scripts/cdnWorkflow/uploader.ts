import { consola } from 'consola';
import dotenv from 'dotenv';

import s3 from './s3';
import type { ImgInfo, S3UserConfig, UploadResult } from './s3/types';
import { formatPath } from './s3/utils';

dotenv.config();

// R2 env vars take priority, fall back to legacy S3 vars
const accessKeyId = process.env.R2_ACCESS_KEY_ID || process.env.DOC_S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || process.env.DOC_S3_SECRET_ACCESS_KEY;
const endpoint =
  process.env.R2_ENDPOINT || 'https://d35842305b91be4b48e06ff9a9ad83f5.r2.cloudflarestorage.com';
const bucketName = process.env.R2_BUCKET_NAME || 'hub-apac-1';
const publicDomain = process.env.DOC_S3_PUBLIC_DOMAIN;

if (!accessKeyId) {
  consola.error('Missing env: R2_ACCESS_KEY_ID or DOC_S3_ACCESS_KEY_ID');
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
}

if (!secretAccessKey) {
  consola.error('Missing env: R2_SECRET_ACCESS_KEY or DOC_S3_SECRET_ACCESS_KEY');
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
}

if (!publicDomain) {
  consola.error('Missing env: DOC_S3_PUBLIC_DOMAIN');
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
}

export const BASE_PATH = 'blog/assets';

export const uploader = async (
  file: File,
  filename: string,
  basePath: string = BASE_PATH,
  uploadPath?: string,
) => {
  const item: ImgInfo = {
    buffer: Buffer.from(await file.arrayBuffer()),
    extname: file.name.split('.').pop() as string,
    fileName: file.name,
    mimeType: file.type,
  };

  const userConfig: S3UserConfig = {
    accessKeyId: accessKeyId || '',
    bucketName,
    endpoint,
    pathPrefix: publicDomain || '',
    pathStyleAccess: true,
    region: 'auto',
    secretAccessKey: secretAccessKey || '',
    uploadPath: uploadPath || `${basePath}${filename}.{extName}`,
  };

  const client = s3.createS3Client(userConfig);

  let results: UploadResult;

  try {
    results = await s3.createUploadTask({
      acl: 'public-read',
      bucketName: userConfig.bucketName,
      client,
      item: item,
      path: formatPath(item, userConfig.uploadPath),
      urlPrefix: userConfig.pathPrefix,
    });

    return results.url;
  } catch (error) {
    consola.error('上传到 S3 存储发生错误，请检查网络连接和配置是否正确');
    consola.error(error);
  }
};
