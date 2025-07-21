export interface EmailTransportConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  pool: boolean;
  maxConnections: number;
  maxMessages: number;
  rateDelta: number;
  rateLimit: number;
}

export interface EmailDefaultsConfig {
  from: string;
  replyTo?: string;
}

export interface EmailEtherealConfig {
  enabled: boolean;
}

export interface EmailTemplatesConfig {
  viewPath: string;
  cache: boolean;
}

export interface EmailConfig {
  transport: EmailTransportConfig;
  defaults: EmailDefaultsConfig;
  ethereal: EmailEtherealConfig;
  templates: EmailTemplatesConfig;
}
