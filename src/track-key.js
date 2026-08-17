/**
 * Track identity — the string a preset is filed under.
 *
 * A YouTube watch URL accumulates junk (`&list=`, `&start_radio=`, `&t=`), so matching on
 * the whole URL would miss. The video id is the stable part. Everything else falls back to
 * origin + path, which is right for Smule and for a local file served over http.
 *
 * DUPLICATED, DELIBERATELY: content.js is injected as a classic script and cannot import,
 * so it carries its own copy of this function. The host app has a third in
 * TypeScript. All three must agree — change one, change all three.
 */
export const trackKey = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./, '');

    if (host === 'youtu.be') {
      const id = url.pathname.slice(1).split('/')[0];
      return id ? `yt:${id}` : '';
    }

    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = url.searchParams.get('v');
      if (v) return `yt:${v}`;
      const match = url.pathname.match(/\/(?:embed|shorts|live)\/([^/?#]+)/);
      if (match) return `yt:${match[1]}`;
    }

    return `url:${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
};
