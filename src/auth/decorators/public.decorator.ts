import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Marca uma rota como isenta do JwtAuthGuard global (ex: registro e login,
// que precisam ser acessíveis sem token — ninguém tem token antes de logar).
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
