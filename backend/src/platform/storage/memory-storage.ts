import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Tenancy } from '../tenancy';
import { StorageProvider, storingCompany } from './storage-provider';

/**
 * Bytes in a Map, for the suite.
 *
 * Same reasoning as `DevMailer`: a test that uploads a file should not leave one on the disk of
 * whoever ran it, and a test that downloads one should be reading what the endpoint stored
 * rather than what a previous run left behind. Nothing survives the process, which is the
 * point — every test starts from the same empty store the database starts from.
 */
@Injectable()
export class MemoryStorage extends StorageProvider {
  private readonly objects = new Map<string, Buffer>();

  constructor(private readonly tenancy: Tenancy) {
    super();
  }

  async put(_filename: string, bytes: Buffer, _contentType: string): Promise<string> {
    const key = `${storingCompany(this.tenancy)}/${randomUUID()}`;
    this.objects.set(key, Buffer.from(bytes));
    return key;
  }

  async get(key: string): Promise<Buffer | undefined> {
    return this.objects.get(key);
  }

  async remove(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
