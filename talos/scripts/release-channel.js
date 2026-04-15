const SUPPORTED_CHANNELS = new Set(['beta', 'prod']);

export const ensurePrefixLike = (input) => {
  let prefix = String(input ?? '').trim();
  if (!prefix) return '';
  prefix = prefix.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!prefix.startsWith('/')) {
    prefix = `/${prefix}`;
  }
  prefix = prefix.replace(/\/+$/, '');
  return prefix === '/' ? '' : prefix;
};

export const getDeployChannel = () => {
  const raw = String(process.env.DEPLOY_CHANNEL ?? 'prod').trim().toLowerCase();
  return SUPPORTED_CHANNELS.has(raw) ? raw : 'prod';
};

const deriveBetaPrefix = (basePrefix) => {
  const normalized = ensurePrefixLike(basePrefix);
  if (!normalized) return '/_beta';

  if (normalized.includes('_dev')) return normalized.replace('_dev', '_beta');
  if (normalized.includes('-dev')) return normalized.replace('-dev', '-beta');
  if (normalized.includes('/dev/')) return normalized.replace('/dev/', '/beta/');
  if (normalized.endsWith('/dev')) return normalized.replace(/\/dev$/, '/beta');

  return `${normalized}-beta`;
};

export const resolveDeployPrefix = ({ basePrefix, channel, target, deployChannels }) => {
  const normalizedBase = ensurePrefixLike(basePrefix);
  const normalizedChannel = SUPPORTED_CHANNELS.has(channel) ? channel : 'prod';

  const envSpecific =
    normalizedChannel === 'beta'
      ? process.env.DEPLOY_BETA_PREFIX
      : process.env.DEPLOY_PROD_PREFIX;
  if (envSpecific && String(envSpecific).trim()) {
    return {
      prefix: ensurePrefixLike(envSpecific),
      source: normalizedChannel === 'beta' ? 'env:DEPLOY_BETA_PREFIX' : 'env:DEPLOY_PROD_PREFIX',
    };
  }

  if (process.env.DEPLOY_PREFIX && String(process.env.DEPLOY_PREFIX).trim()) {
    return {
      prefix: ensurePrefixLike(process.env.DEPLOY_PREFIX),
      source: 'env:DEPLOY_PREFIX',
    };
  }

  const targetKey = target === 'r2' ? 'r2Prefix' : 'ossPrefix';
  const fromConfig = deployChannels?.[normalizedChannel]?.[targetKey];
  if (fromConfig && String(fromConfig).trim()) {
    return {
      prefix: ensurePrefixLike(fromConfig),
      source: `config:deployChannels.${normalizedChannel}.${targetKey}`,
    };
  }

  if (normalizedChannel === 'beta') {
    return {
      prefix: deriveBetaPrefix(normalizedBase),
      source: 'derived:beta-from-base-prefix',
    };
  }

  return {
    prefix: normalizedBase,
    source: 'config:base-prefix',
  };
};

export const joinCdnPath = (cdnBase, prefix) => {
  const base = String(cdnBase ?? '').replace(/\/+$/, '');
  const normalizedPrefix = ensurePrefixLike(prefix);
  if (!base) return normalizedPrefix;
  return normalizedPrefix ? `${base}${normalizedPrefix}` : base;
};
