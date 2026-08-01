import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'erp:public';

/**
 * Lets a route be reached without a session.
 *
 * Every endpoint is guarded by default, so this is the only way out and it has to be
 * written on the handler itself — visible in review, greppable across forty modules, and
 * impossible to arrive at by forgetting something. Sign-up and sign-in are the whole of its
 * legitimate use today: they are the endpoints a caller with no session must reach in order
 * to get one.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);
