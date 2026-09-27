import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { Prisma, Role, User } from '../../generated/prisma/client';
import { requireEnv } from '../common/env.util';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<TokenPair> {
    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });

    let user: User;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('praxis_diary:bootstrap_admin')::bigint)`;

        const adminsCount = await tx.user.count({
          where: { role: Role.ADMIN },
        });
        const role = adminsCount === 0 ? Role.ADMIN : Role.USER;

        return tx.user.create({
          data: {
            name: dto.name,
            email: dto.email,
            passwordHash,
            role,
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('E-mail já cadastrado');
      }
      throw error;
    }

    return this.issueTokens({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
  }

  async login(dto: LoginDto): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const passwordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    return this.issueTokens({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
  }

  async refresh(payload: JwtPayload): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    return this.issueTokens({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
  }

  private issueTokens(payload: JwtPayload): TokenPair {
    const accessToken = this.jwtService.sign(payload, {
      secret: requireEnv('JWT_ACCESS_SECRET'),
      expiresIn: requireEnv('JWT_ACCESS_EXPIRES_IN') as any,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: requireEnv('JWT_REFRESH_SECRET'),
      expiresIn: requireEnv('JWT_REFRESH_EXPIRES_IN') as any,
    });

    return { accessToken, refreshToken };
  }
}
