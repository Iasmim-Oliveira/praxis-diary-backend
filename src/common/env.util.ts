// process.env[chave] é sempre tipado como `string | undefined` pelo TypeScript,
// mesmo pra variáveis que sabemos que devem existir (ex: segredos do JWT).
// Essa função centraliza a checagem: falha rápido e com mensagem clara na
// inicialização da aplicação, em vez de deixar `undefined` vazar silenciosamente.
export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${key}`);
  }
  return value;
}
