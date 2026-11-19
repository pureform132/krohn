/* URL helpers for bookmark / embed / video / audio blocks. */

export interface EmbedInfo {
  type: 'youtube' | 'vimeo' | 'spotify' | 'generic';
  src: string;
  label: string;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0];
  }
}

export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0] || null;
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtube-nocookie.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const m = /^\/(?:embed|shorts|live)\/([\w-]{6,})/.exec(u.pathname);
      if (m) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

export function embedFor(url: string): EmbedInfo | null {
  const clean = url.trim();
  if (!clean) return null;
  const yt = youtubeId(clean);
  if (yt) return { type: 'youtube', src: `https://www.youtube-nocookie.com/embed/${yt}`, label: 'YouTube' };
  try {
    const u = new URL(clean);
    if (u.hostname.includes('vimeo.com')) {
      const id = u.pathname.split('/').filter(Boolean)[0];
      if (id) return { type: 'vimeo', src: `https://player.vimeo.com/video/${id}`, label: 'Vimeo' };
    }
    if (u.hostname.includes('spotify.com')) {
      const parts = u.pathname.split('/').filter(Boolean);
      const kind = parts[0];
      const id = parts[1];
      if (kind && id) return { type: 'spotify', src: `https://open.spotify.com/embed/${kind}/${id}`, label: 'Spotify' };
    }
    if (['http:', 'https:'].includes(u.protocol)) {
      return { type: 'generic', src: clean, label: hostOf(clean) };
    }
  } catch {
    return null;
  }
  return null;
}

export function isImageUrl(url: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i.test(url.trim());
}
