import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { requireEnv } from '../../common/env.util';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requireEnv('JWT_ACCESS_SECRET'),
    });
  }

  // O Passport já verificou assinatura e expiração antes de chamar validate().
  // O que essa função retorna vira `request.user` em toda rota protegida.
  validate(payload: JwtPayload): JwtPayload {
    return payload;
  }
}
