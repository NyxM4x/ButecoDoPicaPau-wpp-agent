import { Controller, Get, UseGuards } from '@nestjs/common';
import { ServiceOrStaffAuthGuard } from '../common/guards/service-or-staff-auth.guard';
import { OperationalSettingsService } from './operational-settings.service';

/**
 * `GET /restaurant/profile` del contrato del POS (`docs/pos-contract.md`).
 *
 * Solo lectura. Los datos se editan con `PATCH /operational-settings` (sesión
 * de administrador): en este backend el perfil y la configuración operativa
 * son la misma fila.
 */
@Controller('restaurant')
export class RestaurantProfileController {
  constructor(private readonly settings: OperationalSettingsService) {}

  @Get('profile')
  @UseGuards(ServiceOrStaffAuthGuard)
  getProfile() {
    return this.settings.getProfile();
  }
}
