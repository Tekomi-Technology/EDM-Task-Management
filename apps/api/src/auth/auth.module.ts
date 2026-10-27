import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ENV, type Env } from '../config/env';
import { UsersModule } from '../users/users.module';
import { AuthGuard } from './auth.guard';
import { createKeycloakJwks, JWKS } from './jwks';

@Module({
  imports: [UsersModule],
  providers: [
    { provide: JWKS, inject: [ENV], useFactory: (env: Env) => createKeycloakJwks(env) },
    { provide: APP_GUARD, useClass: AuthGuard }
  ]
})
export class AuthModule {}
