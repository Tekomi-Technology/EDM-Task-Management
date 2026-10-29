import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ENV, type Env } from '../config/env';

const UPLOAD_URL_SECONDS = 600;
const DOWNLOAD_URL_SECONDS = 3600;

/** Photo storage over the S3 protocol (SeaweedFS locally, MinIO or any S3 in production). */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  /** Signs URLs with the address phones and browsers can reach. */
  private readonly publicClient: S3Client;
  readonly bucket: string;

  constructor(@Inject(ENV) env: Env) {
    const base = {
      region: env.S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
      // Newer AWS SDKs put an empty-body checksum into presigned URLs, which breaks uploads to
      // non-AWS S3 servers (MinIO, SeaweedFS). Only add checksums when an operation requires them.
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      responseChecksumValidation: 'WHEN_REQUIRED' as const
    };
    this.client = new S3Client({ ...base, endpoint: env.S3_ENDPOINT });
    this.publicClient = new S3Client({ ...base, endpoint: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT });
    this.bucket = env.S3_BUCKET;
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Created bucket ${this.bucket}`);
    }
  }

  /** The Content-Type is part of the signature: the upload must send exactly the type that was checked. */
  presignUpload(key: string, contentType: string): Promise<string> {
    return getSignedUrl(
      this.publicClient,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      {
        expiresIn: UPLOAD_URL_SECONDS,
        signableHeaders: new Set(['content-type'])
      }
    );
  }

  /**
   * The answer always carries the type recorded when the upload was checked, whatever the uploader sent, so a file
   * stored as something else (a web page with a script) is never served as such from the app's own address.
   */
  presignDownload(key: string, contentType: string): Promise<string> {
    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: contentType,
        ResponseContentDisposition: 'inline'
      }),
      { expiresIn: DOWNLOAD_URL_SECONDS }
    );
  }

  /** Size in bytes if the object exists, otherwise null. */
  async objectSize(key: string): Promise<number | null> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return head.ContentLength ?? 0;
    } catch {
      return null;
    }
  }

  /** The first bytes of the object, to check what kind of file it really is. */
  async objectStart(key: string, bytes: number): Promise<Uint8Array> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${bytes - 1}` })
    );
    return res.Body ? await res.Body.transformToByteArray() : new Uint8Array();
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}
