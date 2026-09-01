import { Global, Module } from '@nestjs/common';
import { LocalFilesystemStorage } from './local-filesystem-storage';
import { MemoryStorage } from './memory-storage';
import { StorageProvider } from './storage-provider';

/**
 * Global, like `MailModule`: storing a file is one capability with one answer per deployment,
 * and a module that needs it should not have to declare a dependency on the platform to get it.
 */
@Global()
@Module({
  providers: [
    LocalFilesystemStorage,
    MemoryStorage,
    {
      /**
       * Bound on the environment, exactly as the mailer is: the suite gets the in-memory store
       * so a test run writes nothing to anyone's disk, and everything else gets the local
       * filesystem. A deployment on object storage replaces this binding and nothing else.
       */
      provide: StorageProvider,
      useFactory: (local: LocalFilesystemStorage, memory: MemoryStorage) =>
        process.env.NODE_ENV === 'test' ? memory : local,
      inject: [LocalFilesystemStorage, MemoryStorage],
    },
  ],
  exports: [StorageProvider],
})
export class StorageModule {}
