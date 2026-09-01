import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Injectable } from '@nestjs/common';
import { Tenancy } from '../tenancy';
import { StorageProvider, storingCompany } from './storage-provider';

/**
 * Files on this machine's disk, under one root directory.
 *
 * The development and single-server answer. It is deliberately dull: object storage is a
 * capability the application should be able to have before anyone has chosen a cloud for it,
 * and a deployment that outgrows a local disk swaps the binding rather than the callers.
 *
 * The key is generated here rather than taken from the caller, and the filename the user chose
 * never reaches the path — a name is free text arriving over HTTP, and one containing `..` is
 * how an upload writes outside its directory. The original name is stored in the database
 * column that exists for it; the disk only ever sees a uuid.
 */
@Injectable()
export class LocalFilesystemStorage extends StorageProvider {
  private readonly root: string;

  constructor(private readonly tenancy: Tenancy) {
    super();
    this.root = resolve(process.env.STORAGE_ROOT || join(process.cwd(), '.storage'));
  }

  async put(_filename: string, bytes: Buffer, _contentType: string): Promise<string> {
    const key = `${storingCompany(this.tenancy)}/${randomUUID()}`;
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    return key;
  }

  async get(key: string): Promise<Buffer | undefined> {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      return undefined;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  /**
   * A key resolved under the root, and refused if it lands anywhere else.
   *
   * Keys are ours, so this should never fire — which is exactly why it is here rather than
   * assumed: the day a key comes from somewhere less careful, the failure is a refusal instead
   * of a read of an arbitrary file on the server.
   */
  private pathFor(key: string): string {
    const path = resolve(this.root, key);
    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw new Error('A storage key resolved outside the storage root.');
    }
    return path;
  }
}
