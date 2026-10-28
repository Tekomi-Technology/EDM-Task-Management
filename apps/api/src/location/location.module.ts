import { Global, Module } from '@nestjs/common';
import { LocationService } from './location.service';
import { PlacesController } from './places.controller';
import { PlacesService } from './places.service';

@Global()
@Module({
  controllers: [PlacesController],
  providers: [LocationService, PlacesService],
  exports: [LocationService]
})
export class LocationModule {}
