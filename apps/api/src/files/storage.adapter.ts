import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';

export interface StoredFile {
  key: string;
  size: number;
}

export interface StorageAdapter {
  save(buffer: Buffer, originalName: string): Promise<StoredFile>;
  open(key: string): Promise<{ stream: Readable; size: number; name: string } | null>;
}

/**
 * Local filesystem storage (Blueprint §12 — MVP default).
 * The interface is S3-shaped so object storage is a config swap later.
 * Keys are unguessable: <32-hex>__<sanitized original name>.
 */
@Injectable()
export class LocalStorageAdapter implements StorageAdapter {
  private readonly root =
    process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');

  private async ensureRoot(): Promise<void> {
    if (!existsSync(this.root)) {
      await mkdir(this.root, { recursive: true });
    }
  }

  async save(buffer: Buffer, originalName: string): Promise<StoredFile> {
    await this.ensureRoot();
    const safeName = originalName
      .replace(/[^\w.\- ]+/g, '_')
      .slice(0, 120)
      .trim() || 'file';
    const key = `${randomBytes(16).toString('hex')}__${safeName}`;
    await writeFile(join(this.root, key), buffer);
    return { key, size: buffer.length };
  }

  async open(
    key: string,
  ): Promise<{ stream: Readable; size: number; name: string } | null> {
    // Defense in depth: keys never contain path separators.
    if (key.includes('/') || key.includes('\\') || key.includes('..')) {
      return null;
    }
    const filePath = normalize(join(this.root, key));
    if (!filePath.startsWith(this.root)) return null;
    try {
      const info = await stat(filePath);
      if (!info.isFile()) return null;
      const name = key.split('__').slice(1).join('__') || 'file';
      return { stream: createReadStream(filePath), size: info.size, name };
    } catch {
      return null;
    }
  }
}
