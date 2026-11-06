import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { S3StorageDriver, StorageObjectNotFoundError, s3ConfigFromEnv, type S3StorageConfig } from "./s3";
import { storageDriverKind } from "./index";

class MockS3 {
  readonly sent: unknown[] = [];
  objects = new Map<string, Uint8Array>();

  async send(command: unknown): Promise<unknown> {
    this.sent.push(command);
    if (command instanceof PutObjectCommand) {
      this.objects.set(command.input.Key!, command.input.Body as Uint8Array);
      return {};
    }
    if (command instanceof GetObjectCommand) {
      const bytes = this.objects.get(command.input.Key!);
      if (!bytes) throw Object.assign(new Error("The specified key does not exist."), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
      return {
        ContentLength: bytes.byteLength,
        Body: {
          transformToByteArray: async () => bytes,
          transformToWebStream: () => new Blob([Buffer.from(bytes)]).stream(),
        },
      };
    }
    if (command instanceof CopyObjectCommand) {
      const source = decodeURIComponent(command.input.CopySource!.slice(command.input.Bucket!.length + 1));
      this.objects.set(command.input.Key!, this.objects.get(source)!);
      return {};
    }
    if (command instanceof DeleteObjectCommand) {
      this.objects.delete(command.input.Key!);
      return {};
    }
    throw new Error("Unexpected command");
  }
}

const CONFIG: S3StorageConfig = { bucket: "bf-docs", prefix: "prod/", region: "ap-south-1", forcePathStyle: false, sse: "AES256" };
const BYTES = new TextEncoder().encode("%PDF-1.7 test");

describe("s3ConfigFromEnv", () => {
  it("reads the bucket, region, prefix and encryption settings", () => {
    expect(s3ConfigFromEnv({ S3_BUCKET: "bf-docs", S3_REGION: "ap-south-1", S3_PREFIX: "/brickflow/prod/" })).toEqual({
      bucket: "bf-docs",
      prefix: "brickflow/prod/",
      region: "ap-south-1",
      endpoint: undefined,
      forcePathStyle: false,
      sse: "AES256",
      kmsKeyId: undefined,
    });
    expect(s3ConfigFromEnv({ S3_BUCKET: "b", AWS_REGION: "eu-west-1", S3_SSE: "aws:kms", S3_SSE_KMS_KEY_ID: "alias/docs", S3_ENDPOINT: "http://minio:9000", S3_FORCE_PATH_STYLE: "true" })).toMatchObject({
      prefix: "",
      region: "eu-west-1",
      sse: "aws:kms",
      kmsKeyId: "alias/docs",
      endpoint: "http://minio:9000",
      forcePathStyle: true,
    });
  });

  it("fails fast on missing or invalid settings", () => {
    expect(() => s3ConfigFromEnv({ S3_REGION: "ap-south-1" })).toThrow(/S3_BUCKET/);
    expect(() => s3ConfigFromEnv({ S3_BUCKET: "b" })).toThrow(/S3_REGION/);
    expect(() => s3ConfigFromEnv({ S3_BUCKET: "b", S3_REGION: "r", S3_SSE: "none" })).toThrow(/S3_SSE/);
    expect(() => s3ConfigFromEnv({ S3_BUCKET: "b", S3_REGION: "r", S3_SSE: "aws:kms" })).toThrow(/S3_SSE_KMS_KEY_ID/);
    expect(() => s3ConfigFromEnv({ S3_BUCKET: "b", S3_REGION: "r", S3_PREFIX: "a/../b" })).toThrow(/S3_PREFIX/);
  });

  it("accepts only the local and s3 driver names", () => {
    expect(storageDriverKind({})).toBe("local");
    expect(storageDriverKind({ STORAGE_DRIVER: "s3" })).toBe("s3");
    expect(() => storageDriverKind({ STORAGE_DRIVER: "gcs" })).toThrow(/Unsupported STORAGE_DRIVER/);
  });
});

describe("S3StorageDriver", () => {
  it("uploads privately with SSE-S3, a content type and an attachment disposition", async () => {
    const client = new MockS3();
    await new S3StorageDriver(CONFIG, client).put("invoices/2026/11/a.pdf", BYTES, "application/pdf");

    const command = client.sent[0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: "bf-docs",
      Key: "prod/invoices/2026/11/a.pdf",
      ContentType: "application/pdf",
      ContentDisposition: "attachment",
      ContentLength: BYTES.byteLength,
      ServerSideEncryption: "AES256",
    });
    expect(command.input).not.toHaveProperty("ACL");
    expect(command.input.SSEKMSKeyId).toBeUndefined();
  });

  it("uses SSE-KMS with the configured key", async () => {
    const client = new MockS3();
    const driver = new S3StorageDriver({ ...CONFIG, sse: "aws:kms", kmsKeyId: "arn:aws:kms:ap-south-1:1:key/k" }, client);
    await driver.put("invoices/a.pdf", BYTES, "application/pdf");
    await driver.move("invoices/a.pdf", "invoices/b.pdf");
    for (const command of client.sent.slice(0, 2) as (PutObjectCommand | CopyObjectCommand)[]) {
      expect(command.input).toMatchObject({ ServerSideEncryption: "aws:kms", SSEKMSKeyId: "arn:aws:kms:ap-south-1:1:key/k" });
    }
  });

  it("reads objects as bytes and as a stream", async () => {
    const client = new MockS3();
    const driver = new S3StorageDriver(CONFIG, client);
    await driver.put("invoices/a.pdf", BYTES, "application/pdf");

    expect(Buffer.from(await driver.get("invoices/a.pdf")).equals(Buffer.from(BYTES))).toBe(true);
    const { body, contentLength } = await driver.getStream("invoices/a.pdf");
    expect(contentLength).toBe(BYTES.byteLength);
    expect(Buffer.from(await new Response(body).arrayBuffer()).equals(Buffer.from(BYTES))).toBe(true);
    expect((client.sent.at(-1) as GetObjectCommand).input).toEqual({ Bucket: "bf-docs", Key: "prod/invoices/a.pdf" });
  });

  it("reports missing objects", async () => {
    const driver = new S3StorageDriver(CONFIG, new MockS3());
    await expect(driver.get("invoices/missing.pdf")).rejects.toBeInstanceOf(StorageObjectNotFoundError);
    await expect(driver.getStream("invoices/missing.pdf")).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });

  it("moves by encrypted copy then delete", async () => {
    const client = new MockS3();
    const driver = new S3StorageDriver(CONFIG, client);
    await driver.put("quarantine/2026/11/q.pdf", BYTES, "application/pdf");
    await driver.move("quarantine/2026/11/q.pdf", "invoices/2026/11/c.pdf");

    const [, copy, remove] = client.sent as [unknown, CopyObjectCommand, DeleteObjectCommand];
    expect(copy).toBeInstanceOf(CopyObjectCommand);
    expect(copy.input).toMatchObject({
      Bucket: "bf-docs",
      Key: "prod/invoices/2026/11/c.pdf",
      CopySource: "bf-docs/prod/quarantine/2026/11/q.pdf",
      MetadataDirective: "COPY",
      ServerSideEncryption: "AES256",
    });
    expect(remove).toBeInstanceOf(DeleteObjectCommand);
    expect(remove.input).toEqual({ Bucket: "bf-docs", Key: "prod/quarantine/2026/11/q.pdf" });
    expect([...client.objects.keys()]).toEqual(["prod/invoices/2026/11/c.pdf"]);
  });

  it("deletes objects", async () => {
    const client = new MockS3();
    const driver = new S3StorageDriver(CONFIG, client);
    await driver.put("invoices/a.pdf", BYTES, "application/pdf");
    await driver.delete("invoices/a.pdf");
    expect(client.objects.size).toBe(0);
  });

  it("rejects unsafe keys before calling S3", async () => {
    const client = new MockS3();
    const driver = new S3StorageDriver(CONFIG, client);
    for (const key of ["../secrets.pdf", "/abs.pdf", "invoices/../x.pdf", "invoices//x.pdf", "invoices/a b.pdf", ""]) {
      await expect(driver.put(key, BYTES, "application/pdf")).rejects.toThrow(/Invalid storage key/);
    }
    expect(client.sent).toHaveLength(0);
  });
});
