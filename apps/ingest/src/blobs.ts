import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { gzipSync } from 'node:zlib';
import type { IngestConfig } from './config';

export interface BlobStore {
  putJson(key: string, value: unknown): Promise<number>;
}

/** S3-compatible object storage (SeaweedFS locally; AWS S3 / R2 in production). Objects are gzipped JSON. */
export class S3BlobStore implements BlobStore {
  private client: S3Client;
  constructor(private readonly cfg: IngestConfig) {
    this.client = new S3Client({
      endpoint: cfg.S3_ENDPOINT,
      region: cfg.S3_REGION,
      forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: cfg.S3_ACCESS_KEY, secretAccessKey: cfg.S3_SECRET_KEY },
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.cfg.S3_BUCKET }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.cfg.S3_BUCKET }));
    }
  }

  async putJson(key: string, value: unknown): Promise<number> {
    const body = gzipSync(JSON.stringify(value));
    await this.client.send(
      new PutObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key, Body: body, ContentType: 'application/json', ContentEncoding: 'gzip' }),
    );
    return body.length;
  }
}
