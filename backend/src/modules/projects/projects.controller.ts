import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RequestWithUser } from '../../common/types/request-with-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { GitCommitDto } from './dto/git-commit.dto';
import { GitPathDto } from './dto/git-path.dto';
import { ImportGitDto } from './dto/import-git.dto';
import { RenameProjectFileDto } from './dto/rename-project-file.dto';
import { SaveProjectFileDto } from './dto/save-project-file.dto';
import { ArchiveUploadFile, PROJECT_ARCHIVE_MAX_UPLOAD_BYTES, ProjectsService } from './projects.service';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly users: UsersService,
  ) {}

  @Get()
  list(@Req() request: RequestWithUser) {
    return this.projects.list(request.user.sub);
  }

  @Post()
  async create(@Req() request: RequestWithUser, @Body() dto: CreateProjectDto) {
    const owner = await this.users.findById(request.user.sub);
    return this.projects.create(owner, dto);
  }

  @Post(':id/import/git')
  async importGit(
    @Req() request: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: ImportGitDto,
  ) {
    const owner = await this.users.findById(request.user.sub);
    return this.projects.importGit(owner, id, dto);
  }

  @Post(':id/import/archive')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PROJECT_ARCHIVE_MAX_UPLOAD_BYTES } }))
  async importArchive(
    @Req() request: RequestWithUser,
    @Param('id') id: string,
    @UploadedFile() file: ArchiveUploadFile,
  ) {
    const owner = await this.users.findById(request.user.sub);
    return this.projects.importArchive(owner, id, file);
  }

  @Get(':id/git/status')
  gitStatus(@Req() request: RequestWithUser, @Param('id') id: string) {
    return this.projects.gitStatus(request.user.sub, id);
  }

  @Post(':id/git/stage')
  async gitStage(
    @Req() request: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: GitPathDto,
  ) {
    const owner = await this.users.findById(request.user.sub);
    return this.projects.stageGitPath(owner, id, dto.path);
  }

  @Post(':id/git/unstage')
  async gitUnstage(
    @Req() request: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: GitPathDto,
  ) {
    const owner = await this.users.findById(request.user.sub);
    return this.projects.unstageGitPath(owner, id, dto.path);
  }

  @Post(':id/git/stage-all')
  async gitStageAll(@Req() request: RequestWithUser, @Param('id') id: string) {
    const owner = await this.users.findById(request.user.sub);
    return this.projects.stageAllGit(owner, id);
  }

  @Post(':id/git/unstage-all')
  async gitUnstageAll(@Req() request: RequestWithUser, @Param('id') id: string) {
    const owner = await this.users.findById(request.user.sub);
    return this.projects.unstageAllGit(owner, id);
  }

  @Post(':id/git/commit')
  async gitCommit(
    @Req() request: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: GitCommitDto,
  ) {
    const owner = await this.users.findById(request.user.sub);
    return this.projects.commitGit(owner, id, dto);
  }

  @Post(':id/git/push')
  async gitPush(@Req() request: RequestWithUser, @Param('id') id: string) {
    const owner = await this.users.findById(request.user.sub);
    return this.projects.pushGit(owner, id);
  }

  @Delete(':id')
  async remove(@Req() request: RequestWithUser, @Param('id') id: string) {
    const owner = await this.users.findById(request.user.sub);
    return this.projects.remove(owner, id);
  }

  @Get(':id/tree')
  tree(
    @Req() request: RequestWithUser,
    @Param('id') id: string,
    @Query('path') path = '.',
    @Query('depth') depth = '3',
  ) {
    return this.projects.buildTree(request.user.sub, id, path, Number(depth));
  }

  @Get(':id/file')
  file(@Req() request: RequestWithUser, @Param('id') id: string, @Query('path') path: string) {
    return this.projects.readProjectFile(request.user.sub, id, path);
  }

  @Post(':id/file')
  async createFile(
    @Req() request: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: SaveProjectFileDto,
  ) {
    const owner = await this.users.findById(request.user.sub);
    return this.projects.createProjectFile(owner, id, dto.path, dto.content);
  }

  @Put(':id/file')
  async saveFile(
    @Req() request: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: SaveProjectFileDto,
  ) {
    const owner = await this.users.findById(request.user.sub);
    return this.projects.saveProjectFile(owner, id, dto.path, dto.content);
  }

  @Patch(':id/file')
  async renameFile(
    @Req() request: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: RenameProjectFileDto,
  ) {
    const owner = await this.users.findById(request.user.sub);
    return this.projects.renameProjectFile(owner, id, dto.path, dto.newPath);
  }

  @Delete(':id/file')
  async deleteFile(@Req() request: RequestWithUser, @Param('id') id: string, @Query('path') path: string) {
    const owner = await this.users.findById(request.user.sub);
    return this.projects.deleteProjectFile(owner, id, path);
  }
}
