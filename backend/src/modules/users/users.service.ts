import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '../../common/enums/user-role.enum';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  async create(input: {
    email: string;
    name: string;
    passwordHash: string;
    role?: UserRole;
  }): Promise<User> {
    const email = input.email.toLowerCase();
    const existing = await this.findByEmail(email);
    if (existing) {
      throw new ConflictException('Email is already registered.');
    }

    return this.users.save(
      this.users.create({
        email,
        name: input.name,
        passwordHash: input.passwordHash,
        role: input.role ?? UserRole.User,
      }),
    );
  }

  async findById(id: string): Promise<User> {
    const user = await this.users.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.users.findOne({ where: { email: email.toLowerCase() } });
  }

  async findByEmailWithPassword(email: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: email.toLowerCase() })
      .getOne();
  }
}

