import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminUsersService } from './admin-users.service';
import { IdentityAdmin, KeycloakAdmin } from './identity-admin';

@Module({
  controllers: [AdminController],
  providers: [AdminUsersService, { provide: IdentityAdmin, useClass: KeycloakAdmin }]
})
export class AdminModule {}
