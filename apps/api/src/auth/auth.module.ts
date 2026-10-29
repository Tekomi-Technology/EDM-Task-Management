import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { UsersModule } from '../users/users.module';
import { ApiKeysService } from './api-keys.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { SignInSettingsService } from './sign-in-settings.service';
import { TokenService } from './tokens';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    TokenService,
    AuthService,
    ApiKeysService,
    SignInSettingsService,
    { provide: APP_GUARD, useClass: AuthGuard }
  ],
  exports: [AuthService, ApiKeysService, SignInSettingsService]
})
export class AuthModule {}
