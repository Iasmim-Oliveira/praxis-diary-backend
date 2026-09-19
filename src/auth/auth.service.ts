import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { Prisma, User } from '../../generated/prisma/client';
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
      user = await this.prisma.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          passwordHash,
        },
      });
    } catch (error) {
      // P2002 = violação de constraint @unique no Postgres. É o que protege
      // contra duas requisições simultâneas com o mesmo e-mail (race condition):
      // uma checagem prévia no código não seria atômica, o banco é.
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
    });
  }

  async login(dto: LoginDto): Promise<TokenPair> {
    // `email @unique` no schema garante que essa busca só pode retornar 1 registro
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Mensagem de erro genérica de propósito: não revela se o problema foi o
    // e-mail não existir ou a senha estar errada (evita "enumeration attack",
    // onde um atacante descobre quais e-mails estão cadastrados só testando).
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
    });
  }

  async refresh(payload: JwtPayload): Promise<TokenPair> {
    // O refresh token já foi validado (assinatura + expiração) pela JwtRefreshStrategy
    // antes de chegar aqui. Ainda assim, confirmamos que o usuário existe de fato —
    // ele pode ter sido removido depois do token ter sido emitido.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    return this.issueTokens({
      sub: user.id,
      email: user.email,
    });
  }

  private issueTokens(payload: JwtPayload): TokenPair {
    const accessToken = this.jwtService.sign(payload, {
      secret: requireEnv('JWT_ACCESS_SECRET'),
      // `expiresIn` do jsonwebtoken espera um tipo literal (ex: "15m"), mas
      // env vars são sempre `string` pro TypeScript — não dá pra provar em
      // tempo de compilação que o valor bate com o formato esperado.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expiresIn: requireEnv('JWT_ACCESS_EXPIRES_IN') as any,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: requireEnv('JWT_REFRESH_SECRET'),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expiresIn: requireEnv('JWT_REFRESH_EXPIRES_IN') as any,
    });

    return { accessToken, refreshToken };
  }
}
