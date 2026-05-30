import { Request } from 'express';
import { AuthenticatedUser } from './authenticated-user';

export interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}

