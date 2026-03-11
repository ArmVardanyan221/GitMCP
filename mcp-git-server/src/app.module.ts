import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MCPModule } from '@orbit-codes/nestjs-mcp';
import { GitHubModule } from './github/github.module.js';
import { GitLabModule } from './gitlab/gitlab.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MCPModule.register({
      name: 'GitMCPServer',
      version: '1.0.0',
      sseEndpoint: 'mcp/sse',
      messagesEndpoint: 'mcp/messages',
    }),
    GitHubModule,
    GitLabModule,
  ],
})
export class AppModule {}
