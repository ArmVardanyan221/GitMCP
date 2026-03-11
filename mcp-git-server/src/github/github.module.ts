import { Module } from '@nestjs/common';
import { GitHubService } from './github.service.js';

@Module({
  providers: [GitHubService],
  exports: [GitHubService],
})
export class GitHubModule {}
