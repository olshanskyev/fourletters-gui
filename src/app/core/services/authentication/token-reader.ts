export interface TokenReader {
  isTokenValid(): boolean;
  getBearerToken(): string;
}