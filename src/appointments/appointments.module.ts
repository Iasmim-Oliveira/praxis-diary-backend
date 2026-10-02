import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { ServicesModule } from '../services/services.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

@Module({
  imports: [ServicesModule, ClientsModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
})
export class AppointmentsModule {}
