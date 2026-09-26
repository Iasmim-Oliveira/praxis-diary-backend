import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Nunca inclui passwordHash — é a lista/edição que o ADMIN vê na
// "Tela de Gestão de Usuários", não precisa (e não deve) expor o hash.
const SAFE_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.user.findMany({
      select: SAFE_USER_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateRole(id: string, role: Role) {
    const user = await this.findOneOrThrow(id);

    if (user.role === Role.ADMIN && role !== Role.ADMIN) {
      await this.ensureNotLastAdmin(id);
    }

    return this.prisma.user.update({
      where: { id },
      data: { role },
      select: SAFE_USER_SELECT,
    });
  }

  async remove(id: string): Promise<void> {
    const user = await this.findOneOrThrow(id);

    if (user.role === Role.ADMIN) {
      await this.ensureNotLastAdmin(id);
    }

    await this.prisma.user.delete({ where: { id } });
  }

  private async findOneOrThrow(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }
    return user;
  }

  // Regra de negócio: o sistema nunca pode ficar sem nenhum ADMIN (ninguém
  // mais poderia gerenciar usuários depois disso — um "lockout" de si mesmo).
  private async ensureNotLastAdmin(excludingId: string): Promise<void> {
    const otherAdmins = await this.prisma.user.count({
      where: { role: Role.ADMIN, id: { not: excludingId } },
    });

    if (otherAdmins === 0) {
      throw new ConflictException(
        'Não é possível remover o último administrador do sistema',
      );
    }
  }
}
