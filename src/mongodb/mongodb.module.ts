import { Global, Module } from '@nestjs/common';
import { MongodbService } from './mongodb.service';

@Global()
@Module({
  providers: [MongodbService],
  exports: [MongodbService],
})
export class MongodbModule {}
