import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongoClient, ServerApiVersion } from 'mongodb';
import mongoose from 'mongoose';

@Injectable()
export class MongodbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MongodbService.name);
  private client: MongoClient;
  private readonly uri: string;

  constructor(private readonly configService: ConfigService) {
    this.uri = this.configService.getOrThrow<string>('MONGODB_URI');
    this.client = new MongoClient(this.uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });
  }

  async onModuleInit() {
    await mongoose.connect(this.uri);
    await this.client.connect();
    await this.client.db('admin').command({ ping: 1 });
    this.logger.log('Successfully connected to MongoDB');
  }

  async onModuleDestroy() {
    await mongoose.disconnect();
    await this.client.close();
  }

  getClient(): MongoClient {
    return this.client;
  }
}
