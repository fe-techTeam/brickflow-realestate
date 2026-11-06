import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
  type ServerSideEncryption,
} from "@aws-sdk/client-s3";
import { assertValidKey, type StorageDriver, type StorageObjectStream } from "./types";

export interface S3StorageConfig {
  bucket: string;
  /** Normalised key prefix: empty, or ending with "/". */
  prefix: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  sse: "AES256" | "aws:kms";
  kmsKeyId?: string;
}

/** The subset of the S3 client the driver uses; tests inject a mock. */
export interface S3CommandClient {
  send(command: unknown): Promise<unknown>;
}

const PREFIX_PATTERN = /^[A-Za-z0-9._\-/]*$/;

export function s3ConfigFromEnv(env: Record<string, string | undefined> = process.env): S3StorageConfig {
  const bucket = env.S3_BUCKET?.trim();
  if (!bucket) throw new Error("STORAGE_DRIVER=s3 requires S3_BUCKET to be set");
  const region = (env.S3_REGION ?? env.AWS_REGION)?.trim();
  if (!region) throw new Error("STORAGE_DRIVER=s3 requires S3_REGION (or AWS_REGION) to be set");

  const rawPrefix = (env.S3_PREFIX ?? "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!PREFIX_PATTERN.test(rawPrefix) || rawPrefix.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("S3_PREFIX may only contain letters, digits, '.', '_', '-' and '/'");
  }

  const sse = (env.S3_SSE ?? "AES256").trim();
  if (sse !== "AES256" && sse !== "aws:kms") throw new Error(`S3_SSE must be "AES256" or "aws:kms", got "${sse}"`);
  const kmsKeyId = env.S3_SSE_KMS_KEY_ID?.trim() || undefined;
  if (sse === "aws:kms" && !kmsKeyId) throw new Error("S3_SSE=aws:kms requires S3_SSE_KMS_KEY_ID");

  return {
    bucket,
    prefix: rawPrefix ? `${rawPrefix}/` : "",
    region,
    endpoint: env.S3_ENDPOINT?.trim() || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
    sse,
    kmsKeyId: sse === "aws:kms" ? kmsKeyId : undefined,
  };
}

/** Builds an S3 client; credentials come from the AWS default provider chain (env, profile, IAM role). */
export function createS3Client(config: S3StorageConfig): S3Client {
  return new S3Client({ region: config.region, endpoint: config.endpoint, forcePathStyle: config.forcePathStyle });
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NoSuchKey" || e.name === "NotFound" || e.$metadata?.httpStatusCode === 404;
}

export class StorageObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`Storage object not found: ${key}`);
    this.name = "StorageObjectNotFoundError";
  }
}

/** Private, server-side-encrypted S3 storage. Objects are only ever served through the authorised download route. */
export class S3StorageDriver implements StorageDriver {
  constructor(
    private readonly config: S3StorageConfig,
    private readonly client: S3CommandClient = createS3Client(config),
  ) {}

  objectKey(key: string): string {
    assertValidKey(key);
    return `${this.config.prefix}${key}`;
  }

  private encryption(): { ServerSideEncryption: ServerSideEncryption; SSEKMSKeyId?: string } {
    return this.config.sse === "aws:kms"
      ? { ServerSideEncryption: "aws:kms", SSEKMSKeyId: this.config.kmsKeyId }
      : { ServerSideEncryption: "AES256" };
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: this.objectKey(key),
        Body: bytes,
        ContentLength: bytes.byteLength,
        ContentType: contentType,
        ContentDisposition: "attachment",
        ...this.encryption(),
      }),
    );
  }

  private async fetch(key: string): Promise<GetObjectCommandOutput> {
    try {
      const output = (await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: this.objectKey(key) }))) as GetObjectCommandOutput;
      if (!output.Body) throw new StorageObjectNotFoundError(key);
      return output;
    } catch (error) {
      if (isNotFound(error)) throw new StorageObjectNotFoundError(key);
      throw error;
    }
  }

  async get(key: string): Promise<Uint8Array> {
    const output = await this.fetch(key);
    return output.Body!.transformToByteArray();
  }

  async getStream(key: string): Promise<StorageObjectStream> {
    const output = await this.fetch(key);
    return {
      body: output.Body!.transformToWebStream() as ReadableStream<Uint8Array>,
      contentLength: typeof output.ContentLength === "number" ? output.ContentLength : null,
    };
  }

  async move(fromKey: string, toKey: string): Promise<void> {
    const source = this.objectKey(fromKey);
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.config.bucket,
        Key: this.objectKey(toKey),
        CopySource: `${this.config.bucket}/${source.split("/").map(encodeURIComponent).join("/")}`,
        // COPY keeps the content type and disposition set on upload; encryption must be restated on every copy.
        MetadataDirective: "COPY",
        ...this.encryption(),
      }),
    );
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: source }));
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: this.objectKey(key) }));
  }
}
