import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { OperationalSettingsController } from './operational-settings.controller';
import { RestaurantProfileController } from './restaurant-profile.controller';
import { OperationalSettingsService } from './operational-settings.service';

@Module({
  imports: [CommonModule, AuthModule],
  controllers: [OperationalSettingsController, RestaurantProfileController],
  providers: [OperationalSettingsService],
  exports: [OperationalSettingsService],
})
export class OperationalSettingsModule {}
