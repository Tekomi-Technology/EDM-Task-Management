import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';
import { AdminUsersService } from './admin-users.service';
import { AreasService } from './areas.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [AdminUsersService, AreasService]
})
export class AdminModule {}
