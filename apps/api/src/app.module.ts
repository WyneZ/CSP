import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { SitesModule } from './sites/sites.module';
import { MaterialsModule } from './materials/materials.module';
import { VendorsModule } from './vendors/vendors.module';
import { StockModule } from './stock/stock.module';
import { RequisitionsModule } from './requisitions/requisitions.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    SitesModule,
    MaterialsModule,
    VendorsModule,
    StockModule,
    RequisitionsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
