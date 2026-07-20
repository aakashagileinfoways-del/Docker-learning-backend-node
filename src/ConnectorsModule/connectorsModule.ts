import { Module } from '@nestjs/common';
import { EventModule } from '../EventModule/eventModule';
import { GitHubModule } from '../GitHubModule/githubModule';
import ConnectorConnectionEntity from './connectorConnectionEntity';
import { ConnectorsController } from './connectorsController';
import { ConnectorsService } from './connectorsService';

@Module({
  imports: [EventModule, GitHubModule],
  controllers: [ConnectorsController],
  providers: [
    ConnectorsService,
    {
      provide: 'CONNECTOR_CONNECTION_REPOSITORY',
      useValue: ConnectorConnectionEntity,
    },
  ],
  exports: [ConnectorsService],
})
export class ConnectorsModule {}
