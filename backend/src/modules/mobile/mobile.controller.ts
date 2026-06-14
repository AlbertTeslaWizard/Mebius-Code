import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { RequestWithUser } from '../../common/types/request-with-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MobileService } from './mobile.service';

@Controller('mobile')
@UseGuards(JwtAuthGuard)
export class MobileController {
  constructor(private readonly mobile: MobileService) {}

  @Get('overview')
  overview(@Req() request: RequestWithUser) {
    return this.mobile.overview(request.user.sub);
  }
}
