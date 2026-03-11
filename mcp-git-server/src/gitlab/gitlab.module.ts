import { Module } from '@nestjs/common';
import { GitLabService } from './gitlab.service.js';

@Module({
  providers: [GitLabService],
  exports: [GitLabService],
})
export class GitLabModule {}
