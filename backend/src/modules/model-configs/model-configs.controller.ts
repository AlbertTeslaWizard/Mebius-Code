import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { RequestWithUser } from '../../common/types/request-with-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { CreateModelConfigDto } from './dto/create-model-config.dto';
import { UpdateModelConfigDto } from './dto/update-model-config.dto';
import { ModelConfigsService } from './model-configs.service';

@Controller('model-configs')
@UseGuards(JwtAuthGuard)
export class ModelConfigsController {
  constructor(
    private readonly configs: ModelConfigsService,
    private readonly users: UsersService,
  ) {}

  @Get()
  list(@Req() request: RequestWithUser) {
    return this.configs.list(request.user.sub);
  }

  @Post()
  async create(@Req() request: RequestWithUser, @Body() dto: CreateModelConfigDto) {
    const owner = await this.users.findById(request.user.sub);
    return this.configs.create(owner, dto);
  }

  @Patch(':id')
  update(@Req() request: RequestWithUser, @Param('id') id: string, @Body() dto: UpdateModelConfigDto) {
    return this.configs.update(request.user.sub, id, dto);
  }

  @Delete(':id')
  remove(@Req() request: RequestWithUser, @Param('id') id: string) {
    return this.configs.remove(request.user.sub, id);
  }

  @Post(':id/test')
  test(@Req() request: RequestWithUser, @Param('id') id: string) {
    return this.configs.test(request.user.sub, id);
  }
}

