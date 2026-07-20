import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './AuthModule/auth.module';
import { CommonModule } from './common/common.module';
import { ConnectorsModule } from './ConnectorsModule/connectorsModule';
import { EventModule } from './EventModule/eventModule';
import { GitHubModule } from './GitHubModule/githubModule';
import { MongodbModule } from './mongodb/mongodb.module';
import { TimelineModule } from './TimelineModule/timelineModule';
import { UserModule } from './UserModule/userModule';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CommonModule,
    MongodbModule,
    UserModule,
    AuthModule,
    EventModule,
    TimelineModule,
    GitHubModule,
    ConnectorsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
