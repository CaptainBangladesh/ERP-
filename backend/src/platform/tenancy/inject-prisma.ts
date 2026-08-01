import { Inject } from '@nestjs/common';

/**
 * The database, as a module sees it.
 *
 * A symbol rather than the `PrismaService` class, and that is deliberate: the thing modules
 * inject is not a `PrismaClient`, it is a client with tenant scoping already wrapped around
 * it, and giving the two the same name would make the unscoped one reachable by an honest
 * mistake. There is no token in the container that yields an unscoped client.
 */
export const SCOPED_PRISMA = Symbol('SCOPED_PRISMA');

/**
 * Injects it, in the one line a constructor should need:
 *
 *     constructor(@InjectPrisma() private readonly prisma: ScopedPrisma) {}
 *
 * The decorator exists so the token is not something forty modules have to remember the name
 * of, and so changing how the client is provided is one file rather than forty.
 */
export const InjectPrisma = (): ParameterDecorator => Inject(SCOPED_PRISMA);
