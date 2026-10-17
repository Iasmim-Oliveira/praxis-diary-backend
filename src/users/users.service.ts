import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
    return this.prisma.$transaction(async (tx) => {
      await this.lockAdminRoster(tx);

      const user = await this.findOneOrThrow(tx, id);

      if (user.role === Role.ADMIN && role !== Role.ADMIN) {
        await this.ensureNotLastAdmin(tx, id);
      }

      return tx.user.update({
        where: { id },
        data: { role },
        select: SAFE_USER_SELECT,
      });
    });
  }

  async remove(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockAdminRoster(tx);

      const user = await this.findOneOrThrow(tx, id);

      if (user.role === Role.ADMIN) {
        await this.ensureNotLastAdmin(tx, id);
      }

      try {
        await tx.user.delete({ where: { id } });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2003'
        ) {
          throw new ConflictException(
            'Não é possível remover um usuário que criou agendamentos',
          );
        }
        throw error;
      }
    });
  }

  private async lockAdminRoster(tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('praxis_diary:admin_roster')::bigint)`;
  }

  private async findOneOrThrow(tx: Prisma.TransactionClient, id: string) {
    const user = await tx.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }
    return user;
  }

  private async ensureNotLastAdmin(
    tx: Prisma.TransactionClient,
    excludingId: string,
  ): Promise<void> {
    const otherAdmins = await tx.user.count({
      where: { role: Role.ADMIN, id: { not: excludingId } },
    });

    if (otherAdmins === 0) {
      throw new ConflictException(
        'Não é possível remover o último administrador do sistema',
      );
    }
  }
}
