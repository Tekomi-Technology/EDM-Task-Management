import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { reverseGeocodeSchema } from '../contract';
import { Roles } from '../auth/decorators';
import { ApiZodQuery, ZodQuery } from '../common/zod';
import { PlacesService } from './places.service';

@ApiTags('places')
@ApiBearerAuth()
@Controller('places')
@Roles('admin', 'technical_manager', 'team_manager', 'noc', 'bo_support', 'network_team')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get('reverse')
  @ApiOperation({ summary: 'The address of a point marked on the map (null when it is not known)' })
  @ApiZodQuery(reverseGeocodeSchema)
  async reverse(
    @ZodQuery(reverseGeocodeSchema) q: z.infer<typeof reverseGeocodeSchema>
  ): Promise<{ address: string | null }> {
    return { address: await this.places.addressAt(q.lat, q.lng) };
  }
}
