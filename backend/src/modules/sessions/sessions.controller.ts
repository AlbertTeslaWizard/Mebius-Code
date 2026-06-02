import {
  Body,
  Controller,
  Delete,
  Get,
  MessageEvent,
  Param,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { from } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { RequestWithUser } from '../../common/types/request-with-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SseJwtGuard } from '../auth/sse-jwt.guard';
import { EventsService } from '../events/events.service';
import { UsersService } from '../users/users.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { CreateSessionDto } from './dto/create-session.dto';
import { ListSessionsDto } from './dto/list-sessions.dto';
import { SlashCommandDto } from './dto/slash-command.dto';
import { SessionsService } from './sessions.service';

@Controller()
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly users: UsersService,
    private readonly events: EventsService,
  ) {}

  @Post('projects/:projectId/sessions')
  @UseGuards(JwtAuthGuard)
  async create(
    @Req() request: RequestWithUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateSessionDto,
  ) {
    const owner = await this.users.findById(request.user.sub);
    return this.sessions.create(projectId, owner, dto);
  }

  @Get('projects/:projectId/sessions')
  @UseGuards(JwtAuthGuard)
  list(
    @Req() request: RequestWithUser,
    @Param('projectId') projectId: string,
    @Query() query: ListSessionsDto,
  ) {
    return this.sessions.listForProject(request.user.sub, projectId, query);
  }

  @Get('sessions/:id')
  @UseGuards(JwtAuthGuard)
  get(@Req() request: RequestWithUser, @Param('id') id: string) {
    return this.sessions.get(request.user.sub, id);
  }

  @Get('sessions/:id/messages')
  @UseGuards(JwtAuthGuard)
  messages(@Req() request: RequestWithUser, @Param('id') id: string) {
    return this.sessions.listMessages(request.user.sub, id);
  }

  @Post('sessions/:id/messages')
  @UseGuards(JwtAuthGuard)
  addMessage(@Req() request: RequestWithUser, @Param('id') id: string, @Body() dto: CreateMessageDto) {
    return this.sessions.addUserMessage(request.user.sub, id, dto);
  }

  @Post('sessions/:id/commands')
  @UseGuards(JwtAuthGuard)
  command(@Req() request: RequestWithUser, @Param('id') id: string, @Body() dto: SlashCommandDto) {
    return this.sessions.handleCommand(request.user.sub, id, dto);
  }

  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard)
  remove(@Req() request: RequestWithUser, @Param('id') id: string) {
    return this.sessions.remove(request.user.sub, id);
  }

  @Sse('sessions/:id/events')
  @UseGuards(SseJwtGuard)
  eventsStream(@Req() request: RequestWithUser, @Param('id') id: string): Observable<MessageEvent> {
    return from(this.sessions.findOwned(request.user.sub, id)).pipe(
      mergeMap(() => this.events.stream(id)),
    );
  }
}
