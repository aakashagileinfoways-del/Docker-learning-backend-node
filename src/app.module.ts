import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongodbModule } from './mongodb/mongodb.module';
import { UserModule } from './UserModule/userModule';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongodbModule,
    UserModule,
  ],
  controllers: [AppController],
  providers: [AppService],
  exports: [UserModule],
})
export class AppModule {}
