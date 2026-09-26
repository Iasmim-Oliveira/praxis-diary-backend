import { SetMetadata } from '@nestjs/common';
import { Role } from '../../../generated/prisma/client';

export const ROLES_KEY = 'roles';

// Marca uma rota (ou controller inteiro) com os papéis que podem acessá-la.
// Ex: @Roles(Role.ADMIN) — só usuários com role ADMIN passam pelo RolesGuard.
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
