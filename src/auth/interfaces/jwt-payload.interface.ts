export interface JwtPayload {
  sub: string; // id do usuário — "sub" (subject) é o nome padrão do claim no JWT
  tenantId: string;
  email: string;
}
