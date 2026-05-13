// 来源: lib/models/model_provider.dart

export type ProviderType = 'openai' | 'anthropic' | 'google';

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  model: string;
  encryptedApiKey: string;
  isDefault: boolean;
  supportsTools: boolean;
  createdAt: string;
}
